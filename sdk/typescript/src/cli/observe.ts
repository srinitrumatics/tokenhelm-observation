#!/usr/bin/env node
/**
 * `observe` — Observation Protocol v1 conformance CLI.
 *
 * A small, protocol-focused toolbelt over a JSONL event log (the format an EventSource reads),
 * usable by ANY producer in CI regardless of how the events were generated. It reuses the SDK's
 * `validate()` / `normalizeRecord()`, so it agrees with the shared conformance fixtures by
 * construction. Commands deliberately stay limited to protocol validation and interoperability;
 * anything analytics-shaped belongs in the platform, not here.
 *
 *   observe validate  usage_log.jsonl              # protocol-validate every line; exit 1 on violation
 *   observe lint      usage_log.jsonl              # non-fatal warnings (attribution gaps, unpriced…)
 *   observe normalize raw.jsonl                    # arbitrary/legacy record → canonical event (JSONL)
 *   observe stats     usage_log.jsonl              # attribution breakdown + decimal-exact reconcile
 *   observe replay    usage_log.jsonl              # deterministic canonical stream (normalize+dedupe+sort)
 *   observe diff      a.jsonl b.jsonl --ignore metadata.sdk   # field-level diff keyed by event_id
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { PROTOCOL_VERSION, SCHEMA_VERSION, VERSION, type ObservationEvent } from "../index.js";
import {
  computeStats,
  diffLogs,
  lintLog,
  normalizeLog,
  replayLog,
  validateLog,
  type DiffReport,
  type LintReport,
  type NormalizeReport,
  type ReplayReport,
  type StatsReport,
  type ValidateReport,
} from "./core.js";

const COMMANDS = ["validate", "lint", "normalize", "stats", "replay", "diff"] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = `observe — Observation Protocol v1 conformance CLI (cli ${VERSION}, protocol ${PROTOCOL_VERSION})

Usage:
  observe validate  <file.jsonl>            Validate every line against Observation Protocol v1.
                                            Exit 1 if any line is invalid, else 0.
  observe lint      <file.jsonl>            Non-fatal warnings (attribution gaps, unpriced, …).
  observe normalize <file.jsonl>            Canonicalize arbitrary/legacy records → valid events (JSONL).
                                            Exit 1 if any record could not be normalized.
  observe stats     <file.jsonl>            Attribution breakdown + decimal-exact cost/token reconcile.
  observe replay    <file.jsonl>            Deterministic canonical stream (normalize + dedupe + sort).
  observe diff      <a.jsonl> <b.jsonl>     Field-level diff keyed by event_id. Exit 1 if they differ.

Options:
  --ignore <path>   diff: ignore a dot-path field (repeatable), e.g. --ignore metadata.sdk
  --json            Emit a machine-readable JSON report.
  -q, --quiet       validate: print only the summary line, not each problem.
  -h, --help        Show this help.
  --version         Print cli/protocol/schema versions.`;

function emitEvents(events: ObservationEvent[]): void {
  for (const e of events) process.stdout.write(`${JSON.stringify(e)}\n`);
}

export function run(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        ignore: { type: "string", multiple: true },
        json: { type: "boolean", default: false },
        quiet: { type: "boolean", short: "q", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", default: false },
      },
    });
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    process.stdout.write(`observe (Observation Protocol CLI)\n  cli/sdk:  ${VERSION}\n  protocol: ${PROTOCOL_VERSION}\n  schema:   ${SCHEMA_VERSION}\n`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(`${USAGE}\n`);
    return values.help ? 0 : 1;
  }

  const command = positionals[0] as Command;
  if (!COMMANDS.includes(command)) {
    process.stderr.write(`unknown command '${command}'. Expected one of: ${COMMANDS.join(", ")}\n`);
    return 2;
  }

  const ignore = values.ignore ?? [];

  // diff takes two files; everything else takes one.
  if (command === "diff") {
    const fileA = positionals[1];
    const fileB = positionals[2];
    if (fileA === undefined || fileB === undefined) {
      process.stderr.write("diff needs two files: observe diff <a.jsonl> <b.jsonl>\n");
      return 2;
    }
    const a = readOrNull(fileA);
    const b = readOrNull(fileB);
    if (a === null || b === null) return 2;
    const report = diffLogs(a, b, ignore);
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatDiff(report)}\n`);
    return report.equivalent ? 0 : 1;
  }

  const file = positionals[1];
  if (file === undefined) {
    process.stderr.write(`missing <file.jsonl> for '${command}'\n`);
    return 2;
  }
  const text = readOrNull(file);
  if (text === null) return 2;

  switch (command) {
    case "validate": {
      const report = validateLog(text);
      process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatValidate(report, values.quiet)}\n`);
      return report.invalid === 0 ? 0 : 1;
    }
    case "lint": {
      const report = lintLog(text);
      process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatLint(report)}\n`);
      return 0; // warnings are non-fatal
    }
    case "normalize": {
      const report = normalizeLog(text);
      if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        emitEvents(report.events);
        process.stderr.write(`${formatNormalize(report)}\n`);
      }
      return report.skipped.length === 0 ? 0 : 1;
    }
    case "stats": {
      const report = computeStats(text);
      process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatStats(report)}\n`);
      return 0;
    }
    case "replay": {
      const report = replayLog(text);
      if (values.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      else {
        emitEvents(report.events);
        process.stderr.write(`${formatReplay(report)}\n`);
      }
      return 0;
    }
  }
}

function readOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    process.stderr.write(`cannot read ${file}: ${(e as Error).message}\n`);
    return null;
  }
}

// --- human-readable formatting ---

export function formatValidate(report: ValidateReport, quiet = false): string {
  const lines: string[] = [];
  if (!quiet) for (const p of report.problems) lines.push(`  line ${p.lineNo} [${p.kind}] ${p.message}`);
  const ok = report.invalid === 0;
  lines.push(
    `${ok ? "OK" : "FAIL"}: ${report.valid}/${report.total} valid, ${report.invalid} invalid` +
      (ok ? "" : ` (${report.problems.length} problem${report.problems.length === 1 ? "" : "s"})`),
  );
  return lines.join("\n");
}

export function formatLint(report: LintReport): string {
  const lines: string[] = [];
  for (const w of report.warnings) lines.push(`  line ${w.lineNo} [${w.code}] ${w.message}`);
  const codes = Object.entries(report.byCode)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([c, n]) => `${c}=${n}`)
    .join(", ");
  lines.push(`${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"} over ${report.total} event${report.total === 1 ? "" : "s"}${codes ? ` (${codes})` : ""}`);
  return lines.join("\n");
}

export function formatNormalize(report: NormalizeReport): string {
  const lines = report.skipped.map((s) => `  line ${s.lineNo} skipped: ${s.error}`);
  lines.push(`normalized ${report.events.length}/${report.total}${report.skipped.length ? `, ${report.skipped.length} skipped` : ""}`);
  return lines.join("\n");
}

export function formatReplay(report: ReplayReport): string {
  return `replayed ${report.events.length} event${report.events.length === 1 ? "" : "s"} (from ${report.total} line${report.total === 1 ? "" : "s"}; ${report.duplicates} duplicate${report.duplicates === 1 ? "" : "s"}, ${report.skipped} skipped)`;
}

export function formatStats(report: StatsReport): string {
  const lines: string[] = [];
  lines.push(`events: ${report.total}${report.parseErrors ? ` (+${report.parseErrors} unparseable)` : ""}`);
  lines.push(`global: cost=${report.global.cost} tokens=${report.global.tokens} priced=${report.global.priced} unpriced=${report.global.unpriced}`);
  lines.push(`attribution: complete=${report.attribution.complete} partial=${report.attribution.partial} missing=${report.attribution.missing}`);
  lines.push("by provider:");
  for (const g of report.byProvider) lines.push(`  ${g.key}: cost=${g.cost} tokens=${g.tokens} calls=${g.calls}`);
  lines.push("by agent:");
  for (const g of report.byAgent) lines.push(`  ${g.key}: cost=${g.cost} tokens=${g.tokens} calls=${g.calls}`);
  return lines.join("\n");
}

export function formatDiff(report: DiffReport): string {
  const lines: string[] = [];
  for (const id of report.onlyInA) lines.push(`  only in A: ${id}`);
  for (const id of report.onlyInB) lines.push(`  only in B: ${id}`);
  for (const c of report.changed) {
    for (const d of c.diffs) lines.push(`  ${c.event_id} ${d.path}: ${JSON.stringify(d.a)} != ${JSON.stringify(d.b)}`);
  }
  lines.push(
    report.equivalent
      ? `equivalent: ${report.countA} event${report.countA === 1 ? "" : "s"}, no differences`
      : `differ: ${report.onlyInA.length} only-in-A, ${report.onlyInB.length} only-in-B, ${report.changed.length} changed`,
  );
  return lines.join("\n");
}

// Run only when invoked as the executable (not when imported by tests).
const entry = process.argv[1] !== undefined ? pathToFileURL(process.argv[1]).href : "";
if (entry === import.meta.url) {
  process.exit(run(process.argv.slice(2)));
}
