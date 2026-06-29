/**
 * `observe` CLI core — pure functions over a JSONL event log. No process I/O here (the entry
 * `observe.ts` does that), so every behaviour is unit-testable. The validator is the SDK's own
 * `validate()` — the CLI is a *consumer* of the protocol, never a second implementation of it.
 */

import {
  ProtocolValidationError,
  UNKNOWN,
  deriveAttributionStatus,
  dedupeEvents,
  normalizeRecord,
  sortEvents,
  validate,
  type AttributionStatus,
  type ObservationEvent,
} from "../index.js";

const COST_RE = /^[0-9]+(\.[0-9]+)?$/;

export interface ParsedLine {
  lineNo: number;
  value?: Record<string, unknown>;
  parseError?: string;
}

/** Split JSONL into parsed records, keeping blank lines out but tracking 1-based line numbers. */
export function parseJsonl(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue;
    try {
      out.push({ lineNo: i + 1, value: JSON.parse(raw) as Record<string, unknown> });
    } catch (e) {
      out.push({ lineNo: i + 1, parseError: (e as Error).message });
    }
  }
  return out;
}

// --- validate ---

export interface ValidationProblem {
  lineNo: number;
  kind: "parse" | "protocol";
  message: string;
}

export interface ValidateReport {
  total: number;
  valid: number;
  invalid: number;
  problems: ValidationProblem[];
}

/** Validate every line against Observation Protocol v1. */
export function validateLog(text: string): ValidateReport {
  const parsed = parseJsonl(text);
  const problems: ValidationProblem[] = [];
  let valid = 0;
  for (const p of parsed) {
    if (p.parseError !== undefined) {
      problems.push({ lineNo: p.lineNo, kind: "parse", message: p.parseError });
      continue;
    }
    try {
      validate(p.value as Record<string, unknown>);
      valid++;
    } catch (e) {
      if (e instanceof ProtocolValidationError) {
        problems.push({ lineNo: p.lineNo, kind: "protocol", message: e.message });
      } else {
        throw e;
      }
    }
  }
  return { total: parsed.length, valid, invalid: parsed.length - valid, problems };
}

// --- lint (non-fatal warnings) ---

export interface LintWarning {
  lineNo: number;
  code: string;
  message: string;
}

export interface LintReport {
  total: number;
  warnings: LintWarning[];
  byCode: Record<string, number>;
}

/** Soft, non-fatal checks: things worth a producer's attention but not protocol violations. */
export function lintLog(text: string): LintReport {
  const parsed = parseJsonl(text);
  const warnings: LintWarning[] = [];
  const add = (lineNo: number, code: string, message: string) => warnings.push({ lineNo, code, message });

  for (const p of parsed) {
    if (p.value === undefined) continue; // parse errors are validate's concern
    const r = p.value;
    const attribution = readAttribution(r);
    if (attribution !== "complete") {
      add(p.lineNo, "attribution-incomplete", `attribution_status is '${attribution}' — cost cannot be fully attributed`);
    }
    if (readPriced(r) === false) {
      add(p.lineNo, "unpriced", "metadata.priced is false — tokens counted, cost contributes 0");
    }
    if (!isNonEmptyString(r["event_id"])) {
      add(p.lineNo, "no-event-id", "no event_id — a synthetic content-hash id will be assigned downstream");
    }
    if (!isNonEmptyString(r["application_name"])) {
      add(p.lineNo, "no-application-name", "no application_name — events cannot be grouped by app");
    }
  }

  const byCode: Record<string, number> = {};
  for (const w of warnings) byCode[w.code] = (byCode[w.code] ?? 0) + 1;
  return { total: parsed.length, warnings, byCode };
}

// --- normalize (arbitrary/legacy record → canonical event) ---

export interface SkippedRecord {
  lineNo: number;
  error: string;
}

export interface NormalizeReport {
  total: number;
  events: ObservationEvent[];
  skipped: SkippedRecord[];
}

/** Canonicalize every line into a protocol-valid ObservationEvent (reporting un-normalizable ones). */
export function normalizeLog(text: string): NormalizeReport {
  const parsed = parseJsonl(text);
  const events: ObservationEvent[] = [];
  const skipped: SkippedRecord[] = [];
  for (const p of parsed) {
    if (p.parseError !== undefined) {
      skipped.push({ lineNo: p.lineNo, error: `parse error: ${p.parseError}` });
      continue;
    }
    const res = normalizeRecord(p.value);
    if (res.event !== undefined) events.push(res.event);
    else skipped.push({ lineNo: p.lineNo, error: res.error ?? "could not normalize" });
  }
  return { total: parsed.length, events, skipped };
}

// --- replay (deterministic canonical stream) ---

export interface ReplayReport {
  events: ObservationEvent[];
  total: number;
  skipped: number;
  duplicates: number;
}

/**
 * Deterministic replay: normalize → dedupe by event_id → stable sort. Re-running over its own
 * output is idempotent, demonstrating the protocol's immutable-events / deterministic-replay rule.
 */
export function replayLog(text: string): ReplayReport {
  const norm = normalizeLog(text);
  const deduped = dedupeEvents(norm.events);
  return {
    events: sortEvents(deduped),
    total: norm.total,
    skipped: norm.skipped.length,
    duplicates: norm.events.length - deduped.length,
  };
}

// --- diff (field-level comparison of two event logs, keyed by event_id) ---

export interface FieldDiff {
  path: string;
  a: unknown;
  b: unknown;
}

export interface ChangedEvent {
  event_id: string;
  diffs: FieldDiff[];
}

export interface DiffReport {
  countA: number;
  countB: number;
  onlyInA: string[];
  onlyInB: string[];
  changed: ChangedEvent[];
  equivalent: boolean;
}

/**
 * Compare two JSONL event logs field-by-field, keyed by event_id. `ignore` is a list of
 * dot-paths to skip (e.g. "metadata.sdk") — so cross-SDK parity is a one-liner:
 * `observe diff py.jsonl ts.jsonl --ignore metadata.sdk`.
 */
export function diffLogs(textA: string, textB: string, ignore: string[] = []): DiffReport {
  const ignoreSet = new Set(ignore);
  const a = indexByEventId(textA);
  const b = indexByEventId(textB);

  const onlyInA = [...a.keys()].filter((k) => !b.has(k)).sort();
  const onlyInB = [...b.keys()].filter((k) => !a.has(k)).sort();
  const changed: ChangedEvent[] = [];

  for (const [id, recA] of a) {
    const recB = b.get(id);
    if (recB === undefined) continue;
    const diffs = deepDiff(recA, recB, ignoreSet, "");
    if (diffs.length > 0) changed.push({ event_id: id, diffs });
  }
  changed.sort((x, y) => (x.event_id < y.event_id ? -1 : x.event_id > y.event_id ? 1 : 0));

  return {
    countA: a.size,
    countB: b.size,
    onlyInA,
    onlyInB,
    changed,
    equivalent: onlyInA.length === 0 && onlyInB.length === 0 && changed.length === 0,
  };
}

function indexByEventId(text: string): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  let synthetic = 0;
  for (const p of parseJsonl(text)) {
    if (p.value === undefined) continue;
    const id = typeof p.value["event_id"] === "string" && p.value["event_id"] !== "" ? p.value["event_id"] : `:line-${p.lineNo}-${synthetic++}`;
    out.set(id, p.value);
  }
  return out;
}

function deepDiff(a: unknown, b: unknown, ignore: Set<string>, prefix: string): FieldDiff[] {
  if (prefix !== "" && ignore.has(prefix)) return [];
  if (isPlainObject(a) && isPlainObject(b)) {
    const diffs: FieldDiff[] = [];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      const path = prefix === "" ? k : `${prefix}.${k}`;
      if (ignore.has(path)) continue;
      diffs.push(...deepDiff(a[k], b[k], ignore, path));
    }
    return diffs;
  }
  // Arrays and primitives: structural equality via canonical JSON.
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  return [{ path: prefix, a, b }];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// --- stats (attribution + reconciliation report) ---

export interface GroupStat {
  key: string;
  cost: string;
  tokens: number;
  calls: number;
}

export interface StatsReport {
  total: number;
  parseErrors: number;
  attribution: Record<AttributionStatus, number>;
  byProvider: GroupStat[];
  byAgent: GroupStat[];
  global: { cost: string; tokens: number; priced: number; unpriced: number };
}

/** Attribution breakdown + decimal-exact cost/token reconciliation by provider and agent. */
export function computeStats(text: string): StatsReport {
  const parsed = parseJsonl(text);
  const attribution: Record<AttributionStatus, number> = { complete: 0, partial: 0, missing: 0 };
  const providerCosts = new Map<string, string[]>();
  const providerTokens = new Map<string, number>();
  const providerCalls = new Map<string, number>();
  const agentCosts = new Map<string, string[]>();
  const agentTokens = new Map<string, number>();
  const agentCalls = new Map<string, number>();
  const allCosts: string[] = [];
  let totalTokens = 0;
  let priced = 0;
  let unpriced = 0;
  let parseErrors = 0;
  let total = 0;

  for (const p of parsed) {
    if (p.value === undefined) {
      parseErrors++;
      continue;
    }
    total++;
    const r = p.value;
    attribution[readAttribution(r)]++;

    const cost = readCost(r);
    const tokens = readTokens(r);
    const provider = readString(r["provider"]) ?? UNKNOWN;
    const agent = readString(r["agent"]) ?? UNKNOWN;

    pushGroup(providerCosts, providerTokens, providerCalls, provider, cost, tokens);
    pushGroup(agentCosts, agentTokens, agentCalls, agent, cost, tokens);
    allCosts.push(cost);
    totalTokens += tokens;
    if (readPriced(r) === false) unpriced++;
    else priced++;
  }

  return {
    total,
    parseErrors,
    attribution,
    byProvider: toGroups(providerCosts, providerTokens, providerCalls),
    byAgent: toGroups(agentCosts, agentTokens, agentCalls),
    global: { cost: sumDecimals(allCosts), tokens: totalTokens, priced, unpriced },
  };
}

function pushGroup(
  costs: Map<string, string[]>,
  tokens: Map<string, number>,
  calls: Map<string, number>,
  key: string,
  cost: string,
  tok: number,
): void {
  let arr = costs.get(key);
  if (arr === undefined) {
    arr = [];
    costs.set(key, arr);
  }
  arr.push(cost);
  tokens.set(key, (tokens.get(key) ?? 0) + tok);
  calls.set(key, (calls.get(key) ?? 0) + 1);
}

function toGroups(
  costs: Map<string, string[]>,
  tokens: Map<string, number>,
  calls: Map<string, number>,
): GroupStat[] {
  return [...costs.keys()]
    .map((key) => ({
      key,
      cost: sumDecimals(costs.get(key)!),
      tokens: tokens.get(key) ?? 0,
      calls: calls.get(key) ?? 0,
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Exact sum of non-negative decimal strings via BigInt scaling (no float drift). */
export function sumDecimals(values: string[]): string {
  let maxFrac = 0;
  for (const v of values) {
    const dot = v.indexOf(".");
    if (dot >= 0) maxFrac = Math.max(maxFrac, v.length - dot - 1);
  }
  let total = 0n;
  for (const v of values) {
    const dot = v.indexOf(".");
    const intPart = dot >= 0 ? v.slice(0, dot) : v;
    const fracPart = dot >= 0 ? v.slice(dot + 1) : "";
    const scaled = intPart + fracPart.padEnd(maxFrac, "0");
    total += BigInt(scaled === "" ? "0" : scaled);
  }
  if (maxFrac === 0) return total.toString();
  const s = total.toString().padStart(maxFrac + 1, "0");
  return `${s.slice(0, s.length - maxFrac)}.${s.slice(s.length - maxFrac)}`;
}

// --- shared readers (tolerant; the CLI inspects logs that may be legacy or partial) ---

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function readString(v: unknown): string | null {
  return isNonEmptyString(v) ? v : null;
}

function readCost(r: Record<string, unknown>): string {
  const c = r["cost"];
  return typeof c === "string" && COST_RE.test(c) ? c : "0";
}

function readTokens(r: Record<string, unknown>): number {
  const t = r["total_tokens"];
  if (typeof t === "number" && Number.isFinite(t) && t >= 0) return Math.trunc(t);
  const i = r["input_tokens"];
  const o = r["output_tokens"];
  const ii = typeof i === "number" && i >= 0 ? Math.trunc(i) : 0;
  const oo = typeof o === "number" && o >= 0 ? Math.trunc(o) : 0;
  return ii + oo;
}

function readPriced(r: Record<string, unknown>): boolean {
  const m = r["metadata"];
  if (typeof m === "object" && m !== null && "priced" in m) {
    return (m as Record<string, unknown>)["priced"] !== false;
  }
  return r["priced"] !== false;
}

function readAttribution(r: Record<string, unknown>): AttributionStatus {
  const a = r["attribution_status"];
  if (a === "complete" || a === "partial" || a === "missing") return a;
  return deriveAttributionStatus(r["prompt"], r["agent"], r["session_id"]);
}
