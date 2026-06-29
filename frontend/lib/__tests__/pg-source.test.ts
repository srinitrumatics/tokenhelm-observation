import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { newDb } from "pg-mem";
import { JsonlEventSource } from "../observation/jsonl-source";
import { PostgresEventSource, ingestJsonlToPostgres, type PgPool } from "../observation/pg-source";
import { computeSummary } from "../analytics/overview";
import { computePromptLeaderboard } from "../analytics/prompts";
import { computeAgentLeaderboard } from "../analytics/agents";
import { computeWorkflowLeaderboard } from "../analytics/workflows";
import { computeModelAnalytics } from "../analytics/models";
import { assertReconciles, assertTokensReconcile } from "./reconcile";

/**
 * v1.4 — PostgresEventSource. Proves the storage-agnostic seam (constraint #2 / SC-014):
 * the SAME analytics run over a Postgres sink as over JSONL and produce byte-identical events
 * and identical reconciliation. Backed by an in-memory `pg-mem` Postgres so it runs OFFLINE —
 * no Docker, no server, no API key (same spirit as the embedded DuckDB test).
 */

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const jsonl = path.join(FIXTURES, "reconcile-events.jsonl");

/** A fresh in-memory Postgres pool (pg-mem), drop-in for the slice of `pg.Pool` we use. */
function memPool(): PgPool {
  const { Pool } = newDb().adapters.createPg();
  return new Pool() as unknown as PgPool;
}

describe("PostgresEventSource (storage swap, zero analytics change)", () => {
  it("ingests JSONL into Postgres and reads byte-identical events", async () => {
    const pool = memPool();
    const written = await ingestJsonlToPostgres(jsonl, pool);
    expect(written).toBe(7);

    const fromJsonl = (await new JsonlEventSource(jsonl).read()).events;
    const fromPg = (await new PostgresEventSource({ pool }).read()).events;

    expect(fromPg.length).toBe(fromJsonl.length);
    // The core identity: same events ⇒ identical analytics input (SC-014).
    expect(JSON.stringify(fromPg)).toBe(JSON.stringify(fromJsonl));
  });

  it("all five reconciliation identities hold over the Postgres sink", async () => {
    const pool = memPool();
    await ingestJsonlToPostgres(jsonl, pool);
    const events = (await new PostgresEventSource({ pool }).read()).events;

    const global = computeSummary(events).costByCurrency.USD;
    const globalTokens = computeSummary(events).totalTokens;
    expect(global).toBe("0.017");
    expect(globalTokens).toBe(1560);

    const prompts = computePromptLeaderboard(events);
    assertReconciles(
      [...prompts.prompts.map((p) => ({ cost: p.cost })), ...(prompts.unattributed ? [{ cost: prompts.unattributed.cost }] : [])],
      global, "Σ prompt + unattributed (postgres)");

    const agents = computeAgentLeaderboard(events);
    assertReconciles(
      [...agents.agents.filter((a) => agents.roots.includes(a.key)).map((a) => ({ cost: a.rolledCost })), ...(agents.unattributed ? [{ cost: agents.unattributed.cost }] : [])],
      global, "Σ agent rollups + unattributed (postgres)");

    const workflows = computeWorkflowLeaderboard(events);
    assertReconciles(
      [...workflows.workflows.map((w) => ({ cost: w.totalCost })), ...(workflows.unattributed ? [{ cost: workflows.unattributed.totalCost }] : [])],
      global, "Σ workflow + unattributed (postgres)");

    const ma = computeModelAnalytics(events);
    assertReconciles(ma.models, global, "Σ model (postgres)");
    assertReconciles(ma.providers, global, "Σ provider (postgres)");
    assertTokensReconcile(ma.models, globalTokens, "Σ model tokens (postgres)");
  });

  it("a single malformed row is skipped, not fatal", async () => {
    const pool = memPool();
    await ingestJsonlToPostgres(jsonl, pool);
    // Inject one unparseable doc directly (bypassing ingest's JSON guard).
    await pool.query(`INSERT INTO observation_events (event_id, "timestamp", doc) VALUES ($1, $2, $3)`, [
      "broken",
      "2026-06-20T10:00:00+00:00",
      "{ this is not json",
    ]);
    const res = await new PostgresEventSource({ pool }).read();
    expect(res.skipped).toBe(1);
    expect(res.events.length).toBe(7); // the good rows still come through
  });

  it("treats an absent/empty store as cold start, not an error", async () => {
    // Empty DB, table never created.
    const res = await new PostgresEventSource({ pool: memPool() }).read();
    expect(res.present).toBe(false);
    expect(res.events).toEqual([]);
  });
});
