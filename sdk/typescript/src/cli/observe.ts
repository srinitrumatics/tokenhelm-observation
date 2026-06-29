#!/usr/bin/env node
/**
 * `observe` — Observation Protocol v1 conformance CLI.
 *
 * Validate, lint, and summarize a JSONL event log (the format an EventSource reads) against the
 * protocol — usable by ANY producer in CI, regardless of how the events were generated. It reuses
 * the SDK's `validate()`, so it agrees with the shared conformance fixtures by construction.
 *
 *   observe validate usage_log.jsonl        # protocol-validate every line; exit 1 on any violation
 *   observe lint usage_log.jsonl            # non-fatal warnings (attribution gaps, unpriced, …)
 *   observe stats usage_log.jsonl           # attribution breakdown + decimal-exact reconciliation
 *   observe <cmd> file.jsonl --json         # machine-readable report
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { VERSION } from "../index.js";
import {
  computeStats,
  lintLog,
  validateLog,
  type LintReport,
  type StatsReport,
  type ValidateReport,
} from "./core.js";

const COMMANDS = ["validate", "lint", "stats"] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = `observe — Observation Protocol v1 conformance CLI (v${VERSION})

Usage:
  observe validate <file.jsonl>   Validate every line against Observation Protocol v1.
                                  Exit code 1 if any line is invalid, else 0.
  observe lint <file.jsonl>       Report non-fatal warnings (attribution gaps, unpriced, …).
  observe stats <file.jsonl>      Attribution breakdown + decimal-exact cost/token reconciliation.

Options:
  --json        Emit a machine-readable JSON report.
  -q, --quiet   validate: print only the summary line, not each problem.
  -h, --help    Show this help.
  --version     Print the version.`;

export function run(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
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
    process.stdout.write(`${VERSION}\n`);
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
  const file = positionals[1];
  if (file === undefined) {
    process.stderr.write(`missing <file.jsonl> for '${command}'\n`);
    return 2;
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    process.stderr.write(`cannot read ${file}: ${(e as Error).message}\n`);
    return 2;
  }

  if (command === "validate") {
    const report = validateLog(text);
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatValidate(report, values.quiet)}\n`);
    return report.invalid === 0 ? 0 : 1;
  }
  if (command === "lint") {
    const report = lintLog(text);
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatLint(report)}\n`);
    return 0; // warnings are non-fatal
  }
  const report = computeStats(text);
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatStats(report)}\n`);
  return 0;
}

// --- human-readable formatting ---

export function formatValidate(report: ValidateReport, quiet = false): string {
  const lines: string[] = [];
  if (!quiet) {
    for (const p of report.problems) {
      lines.push(`  line ${p.lineNo} [${p.kind}] ${p.message}`);
    }
  }
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

export function formatStats(report: StatsReport): string {
  const lines: string[] = [];
  lines.push(`events: ${report.total}${report.parseErrors ? ` (+${report.parseErrors} unparseable)` : ""}`);
  lines.push(
    `global: cost=${report.global.cost} tokens=${report.global.tokens} priced=${report.global.priced} unpriced=${report.global.unpriced}`,
  );
  lines.push(
    `attribution: complete=${report.attribution.complete} partial=${report.attribution.partial} missing=${report.attribution.missing}`,
  );
  lines.push("by provider:");
  for (const g of report.byProvider) lines.push(`  ${g.key}: cost=${g.cost} tokens=${g.tokens} calls=${g.calls}`);
  lines.push("by agent:");
  for (const g of report.byAgent) lines.push(`  ${g.key}: cost=${g.cost} tokens=${g.tokens} calls=${g.calls}`);
  return lines.join("\n");
}

// Run only when invoked as the executable (not when imported by tests).
const entry = process.argv[1] !== undefined ? pathToFileURL(process.argv[1]).href : "";
if (entry === import.meta.url) {
  process.exit(run(process.argv.slice(2)));
}
