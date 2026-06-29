import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  dedupeEvents,
  sortEvents,
  type EventReadResult,
  type EventSource,
} from "./event-source";
import { normalize } from "./normalize";

/**
 * JsonlEventSource — the v1 EventSource (constraint #2: this is the ONLY storage
 * binding; everything above depends on the EventSource interface, not on JSONL).
 *
 * Reads the append-only usage_log.jsonl, normalizes every line into an
 * ObservationEvent (legacy + canonical), skips-and-counts malformed lines, and
 * deduplicates. Results are cached by a (size+mtime) fingerprint so unchanged logs
 * re-read for free; a changed log triggers a fresh read (SC-006/SC-007). Tail-only
 * incremental reads are a future optimization the interface already permits.
 *
 * Guarantees:
 *  - READ-ONLY: never writes to the log (Constitution III).
 *  - A malformed line never aborts the rest — it is skipped and counted (FR-003/SC-011).
 *  - A missing file yields present:false, not an error (cold start).
 */

interface CacheEntry {
  fingerprint: string;
  result: EventReadResult;
}

export class JsonlEventSource implements EventSource {
  private readonly logPath: string;
  private cache: CacheEntry | null = null;

  constructor(logPath: string = resolveLogPath()) {
    this.logPath = logPath;
  }

  describe(): string {
    return this.logPath;
  }

  async fingerprint(): Promise<string> {
    try {
      const st = await fs.stat(this.logPath);
      return `${st.size}:${st.mtimeMs}`;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return "absent";
      throw err;
    }
  }

  async read(): Promise<EventReadResult> {
    const fp = await this.fingerprint();
    if (this.cache && this.cache.fingerprint === fp) {
      return this.cache.result;
    }

    const result =
      fp === "absent"
        ? { events: [], skipped: 0, duplicates: 0, present: false, source: this.logPath }
        : this.parse(await fs.readFile(this.logPath, "utf8"));

    this.cache = { fingerprint: fp, result };
    return result;
  }

  private parse(raw: string): EventReadResult {
    const normalized = [];
    let skipped = 0;

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue; // blank lines are not "skipped" records
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        skipped++;
        continue;
      }
      const ev = normalize(parsed);
      if (ev) normalized.push(ev);
      else skipped++;
    }

    const { events, duplicates } = dedupeEvents(normalized);
    return {
      events: sortEvents(events),
      skipped,
      duplicates,
      present: true,
      source: this.logPath,
    };
  }
}

/** Resolve the log path from USAGE_LOG_PATH (default ../usage_log.jsonl). */
export function resolveLogPath(): string {
  const configured = process.env.USAGE_LOG_PATH ?? "../usage_log.jsonl";
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}
