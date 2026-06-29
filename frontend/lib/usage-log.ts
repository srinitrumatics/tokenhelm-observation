import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { usageRecordSchema, type UsageRecord } from "./schema";

/**
 * Server-only reader for the append-only usage_log.jsonl audit trail.
 *
 * Guarantees:
 *  - READ-ONLY: this module never writes to the log (Constitution III).
 *  - One malformed/invalid line never aborts the rest — it is skipped and counted
 *    (FR-009 / SC-005).
 *  - A missing file yields an empty result with logPresent=false, not an error
 *    (FR-008).
 */

export interface ReadResult {
  records: UsageRecord[];
  skippedLines: number;
  logPresent: boolean;
  source: string;
}

/** Resolve the log path from USAGE_LOG_PATH (default ../usage_log.jsonl). */
export function resolveLogPath(): string {
  const configured = process.env.USAGE_LOG_PATH ?? "../usage_log.jsonl";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

export async function readUsageLog(logPath = resolveLogPath()): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { records: [], skippedLines: 0, logPresent: false, source: logPath };
    }
    // Permission / I/O error: surface to the caller (becomes a 500 at the API).
    throw err;
  }

  const records: UsageRecord[] = [];
  let skippedLines = 0;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue; // blank lines are not "skipped" records
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      skippedLines++;
      continue;
    }
    const result = usageRecordSchema.safeParse(parsed);
    if (result.success) {
      records.push(result.data);
    } else {
      skippedLines++;
    }
  }

  return { records, skippedLines, logPresent: true, source: logPath };
}
