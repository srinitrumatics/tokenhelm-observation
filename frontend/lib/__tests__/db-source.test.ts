import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { DuckDbEventSource, ingestJsonlToDuckDb } from "../observation/db-source";
import { computeSummary } from "../analytics/overview";
import { computeModelAnalytics } from "../analytics/models";
import { assertReconciles } from "./reconcile";

/**
 * T059 — DuckDbEventSource. Proves the storage-agnostic seam (constraint #2 / SC-014):
 * the SAME analytics run over the DuckDB sink as over JSONL and produce identical events
 * and identical reconciliation. The native binding is real DuckDB; this is an offline test.
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const jsonl = path.join(FIXTURES, "reconcile-events.jsonl");
const dbPath = path.join(os.tmpdir(), `obs-test-${process.pid}-${Date.now()}.duckdb`);

afterAll(async () => {
  await fs.rm(dbPath, { force: true }).catch(() => {});
});

describe("DuckDbEventSource (storage swap, zero analytics change)", () => {
  it("ingests JSONL into DuckDB and reads identical events", async () => {
    const written = await ingestJsonlToDuckDb(jsonl, dbPath);
    expect(written).toBe(7);

    const fromJsonl = (await new JsonlEventSource(jsonl).read()).events;
    const fromDuck = (await new DuckDbEventSource(dbPath).read()).events;

    expect(fromDuck.length).toBe(fromJsonl.length);
    // Byte-identical event streams → identical analytics input (SC-014).
    expect(JSON.stringify(fromDuck)).toBe(JSON.stringify(fromJsonl));
  });

  it("reconciliation identities hold over the DuckDB sink", async () => {
    const events = (await new DuckDbEventSource(dbPath).read()).events;
    const global = computeSummary(events).costByCurrency.USD;
    expect(global).toBe("0.017");
    const ma = computeModelAnalytics(events);
    assertReconciles(ma.models, global, "Σ model == global (duckdb)");
    assertReconciles(ma.providers, global, "Σ provider == global (duckdb)");
  });

  it("treats an absent DB as cold start, not an error", async () => {
    const missing = path.join(os.tmpdir(), `obs-absent-${process.pid}-${Date.now()}.duckdb`);
    const res = await new DuckDbEventSource(missing).read();
    expect(res.present).toBe(false);
    expect(res.events).toEqual([]);
  });
});
