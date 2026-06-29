# Adding a new storage backend: implementing `EventSource`

This guide explains how to plug a new storage backend (Postgres, Redis Streams,
OpenTelemetry, S3, …) into the AI Observability Platform by implementing one small
interface — `EventSource`. The dashboard's entire analytics layer is a pure function
of `ObservationEvent[]`, so once your source emits the canonical event stream
correctly, **every** view, breakdown, trend, and reconciliation works unchanged.

All paths below are under `frontend/lib/observation/`.

- `event-source.ts` — the `EventSource` / `EventReadResult` contract + the shared
  helpers `sortEvents`, `dedupeEvents`, and the reference `InMemoryEventSource`.
- `jsonl-source.ts` — reference implementation #1 (file-based).
- `db-source.ts` — reference implementation #2 (`DuckDbEventSource`, native driver).
- `pg-source.ts` — reference implementation #3 (`PostgresEventSource`, SQL driver, v1.4).
- `source.ts` — `getEventSource()`, the `EVENT_SOURCE` selector.
- `normalize.ts` — `normalize(record) → ObservationEvent | null`.
- `replay.ts` — `replay()` / `migrate()` built on the interface.

---

## 1. The contract

```ts
// lib/observation/event-source.ts
export interface EventSource {
  /** Read all currently-available events, normalized + deduped, stably ordered. */
  read(): Promise<EventReadResult>;
  /** Cheap freshness probe so callers can avoid a full re-read when nothing changed. */
  fingerprint(): Promise<string>;
  /** Human-facing identifier (path, DSN label) for meta/debug. */
  describe(): string;
}

export interface EventReadResult {
  events: ObservationEvent[]; // normalized + deduped, deterministic order
  skipped: number;            // malformed/un-normalizable records (counted, never dropped silently)
  duplicates: number;         // records collapsed by event_id dedup
  present: boolean;           // false = source absent/empty (cold start), not an error
  source: string;             // human-facing identifier of where events came from
}
```

### The three methods

- **`read(): Promise<EventReadResult>`** — the workhorse. Pull every currently-available
  raw record out of your store, push each one through `normalize()`, drop the ones that
  come back `null` (counting them as `skipped`), dedupe by `event_id`, sort, and return.
- **`fingerprint(): Promise<string>`** — a *cheap* probe that changes iff the underlying
  data changed. Callers compare fingerprints to skip a full re-read. `JsonlEventSource`
  uses `"${size}:${mtimeMs}"`; `DuckDbEventSource` uses the DB file's size+mtime. For a
  DB you might use a row count + max timestamp, a `max(updated_at)`, or a monotonic
  sequence id. Return the sentinel `"absent"` when the source does not exist yet.
- **`describe(): string`** — a synchronous, human-facing label (a path, a DSN with the
  password stripped). It feeds `meta`/debug output and the `source` field. Never put
  secrets in it.

### `EventReadResult` fields

| field | meaning |
|-------|---------|
| `events` | normalized + deduped events, in deterministic order (timestamp asc, then `event_id`) |
| `skipped` | count of records that failed `JSON.parse` or returned `null` from `normalize()` |
| `duplicates` | count of records collapsed by `dedupeEvents` (same `event_id`) |
| `present` | `false` only for cold start (no source / empty table); `true` once readable |
| `source` | the same value `describe()` returns — provenance for the UI/meta |

### Hard invariants (every implementation MUST honor these)

1. **READ-ONLY (Constitution III).** `read()` and `fingerprint()` must never mutate the
   source — no writes, no schema changes, no destructive migrations. Connect with a
   read-only role where the driver allows it. (Writing/ingesting is a *separate*,
   explicitly-named function — see `ingestJsonlToDuckDb` — never part of `read()`.)
2. **Normalize every record through `normalize()`.** Never hand-roll an
   `ObservationEvent`. `normalize()` is the single place that maps both canonical and
   legacy records into the validated canonical shape and assigns
   `attribution_status` / `event_id` deterministically.
3. **Dedupe by `event_id`** using `dedupeEvents()`. Report the count as `duplicates`.
4. **Return deterministic order** using `sortEvents()` (timestamp ascending, then
   `event_id`). Replay reproducibility depends on this.
5. **Skip-and-count malformed records — never throw on one bad record.** A single
   unparseable row must not abort the read; increment `skipped` and continue.
6. **Absent/empty source ⇒ `present: false` (cold start), not an error.** A missing
   file, a not-yet-created table, or an empty store returns
   `{ events: [], skipped: 0, duplicates: 0, present: false, source: describe() }`.

---

## 2. Why the contract matters

The platform's locked architectural constraint #2 is the **storage-agnostic seam**:
every aggregator depends only on `EventSource` + the `ObservationEvent` contract, never
on a concrete storage format. Because all analytics are **pure, deterministic functions
of `ObservationEvent[]`** (no wall-clock, no randomness), any two conformant sources that
hold the same logical events produce **byte-identical** analytics and reconciliation
(SC-014).

That is what lets `replay.ts` treat replay as "just re-read the immutable source and
recompute", and `migrate()` model a storage swap by copying one source's events into an
`InMemoryEventSource` — aggregating over the copy *must* equal aggregating over the
original. If your `EventSource` honors the six invariants above, you inherit replay,
migration, and all five reconciliation identities for free.

---

## 3. Worked example: `PostgresEventSource`

> **Shipped in v1.4** as `lib/observation/pg-source.ts` (ADR 0005). The code below is the
> guide; the shipped version differs only in small hardening details: an **injectable pool**
> (so the gate test runs offline against in-memory `pg-mem`, no Docker), a `doc text` column
> (`JSON.parse`d on read, like DuckDB), a quoted `"timestamp"` identifier, and `undefined_table`
> detection for the cold-start probe. The lazy-import / register / test / externalize steps are
> exactly as written here.

A backend that stores one canonical event per row in a table
`observation_events(event_id text, "timestamp" text, doc text)` — exactly mirroring the
DuckDB `(event_id, timestamp, doc)` layout, where `doc` is the full canonical JSON.

### 3a. The skeleton

```ts
// lib/observation/pg-source.ts
import "server-only";
import {
  dedupeEvents,
  sortEvents,
  type EventReadResult,
  type EventSource,
} from "./event-source";
import { normalize } from "./normalize";

export const OBSERVATION_TABLE = "observation_events";

export class PostgresEventSource implements EventSource {
  private readonly dsn: string;
  private readonly table: string;

  constructor(dsn: string = resolveDsn(), table: string = OBSERVATION_TABLE) {
    this.dsn = dsn;
    this.table = table;
  }

  describe(): string {
    // Label only — strip credentials. Never leak the password.
    return `postgres:${safeLabel(this.dsn)}`;
  }

  async fingerprint(): Promise<string> {
    const pool = await openPool(this.dsn);
    try {
      // Cheap probe: row count + latest timestamp. Cold/empty table → "absent".
      const reg = await pool.query(
        `SELECT to_regclass($1) AS t`, [this.table],
      );
      if (!reg.rows[0]?.t) return "absent";
      const r = await pool.query(
        `SELECT count(*)::bigint AS n, coalesce(max(timestamp), '') AS hi FROM ${this.table}`,
      );
      const { n, hi } = r.rows[0];
      return Number(n) === 0 ? "absent" : `${n}:${hi}`;
    } finally {
      await closePool(pool);
    }
  }

  async read(): Promise<EventReadResult> {
    if ((await this.fingerprint()) === "absent") {
      return { events: [], skipped: 0, duplicates: 0, present: false, source: this.describe() };
    }

    const pool = await openPool(this.dsn);
    try {
      // READ-ONLY: a plain SELECT, no writes, no DDL.
      const res = await pool.query(`SELECT doc FROM ${this.table}`);
      const rows = res.rows as Array<{ doc: unknown }>;

      const normalized = [];
      let skipped = 0;
      for (const row of rows) {
        let parsed: unknown;
        try {
          // jsonb comes back as an object; a text column would need JSON.parse.
          parsed = typeof row.doc === "string" ? JSON.parse(row.doc) : row.doc;
        } catch {
          skipped++;            // one bad row never aborts the read
          continue;
        }
        const ev = normalize(parsed);
        if (ev) normalized.push(ev);
        else skipped++;        // un-normalizable → counted, not dropped silently
      }

      const { events, duplicates } = dedupeEvents(normalized);
      return {
        events: sortEvents(events),   // deterministic order
        skipped,
        duplicates,
        present: true,
        source: this.describe(),
      };
    } finally {
      await closePool(pool);
    }
  }
}

/** Resolve the DSN from PG_DSN (no insecure default — fail fast if unset). */
export function resolveDsn(): string {
  const dsn = process.env.PG_DSN;
  if (!dsn) throw new Error("PostgresEventSource requires PG_DSN");
  return dsn;
}

function safeLabel(dsn: string): string {
  try {
    const u = new URL(dsn);
    return `${u.host}${u.pathname}`; // host + db name, no user/password
  } catch {
    return "configured";
  }
}
```

Notice this is a near-mechanical copy of `DuckDbEventSource.read()`: parse each `doc`,
`normalize()`, skip-and-count, `dedupeEvents`, `sortEvents`. **Do not** reimplement any
of those helpers — import them from `./event-source` and `./normalize`.

### 3b. Lazily importing the driver (mirroring `db-source.ts`)

`db-source.ts` keeps the native `@duckdb/node-api` addon out of the default code path by
importing it **only inside the connection helper**, via a dynamic `await import(...)`.
Do the same so merely importing your module never loads the driver:

```ts
// --- pg plumbing (lazy driver import) ---------------------------------------
// Typed loosely so the module is import-safe even when `pg` isn't installed.
type PgPool = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  end: () => Promise<void>;
};

async function openPool(dsn: string): Promise<PgPool> {
  const { Pool } = await import("pg");          // loaded on demand only
  return new Pool({ connectionString: dsn, max: 1 }) as unknown as PgPool;
}

async function closePool(pool: PgPool): Promise<void> {
  await pool.end();
}
```

If your backend ships a *write/ingest* path (the normalize-once-at-write model), keep it
a **separate exported function**, exactly like `ingestJsonlToDuckDb` — never inside
`read()`, so the read path stays strictly read-only.

### 3c. Registering it in `getEventSource()`

`source.ts` is the only place that knows about concrete sources. Add a new `EVENT_SOURCE`
value and lazy-require the module so the default (JSONL) path never loads your driver:

```ts
// lib/observation/source.ts
export function getEventSource(): EventSource {
  const kind = (process.env.EVENT_SOURCE ?? "jsonl").toLowerCase();
  if (kind === "duckdb") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DuckDbEventSource } = require("./db-source") as typeof import("./db-source");
    return new DuckDbEventSource();
  }
  if (kind === "postgres") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostgresEventSource } = require("./pg-source") as typeof import("./pg-source");
    return new PostgresEventSource();
  }
  return new JsonlEventSource();
}
```

Now `EVENT_SOURCE=postgres PG_DSN=postgres://… npm run dev` routes every API route
through your source with zero analytics changes.

### 3d. Native modules → `serverExternalPackages`

If your driver is a **native addon** (like `@duckdb/node-api`), add it to
`serverExternalPackages` in `next.config.ts` so Next never tries to bundle it into the
server build:

```ts
// next.config.ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["@duckdb/node-api", "pg"], // add your driver here
};
```

A pure-JS driver usually does not need this, but adding it is harmless and avoids
bundler edge cases with dynamic `import()`.

---

## 4. Testing your source

The tests that *prove* the seam are `lib/__tests__/db-source.test.ts` and (v1.4)
`lib/__tests__/pg-source.test.ts`: they ingest the shared fixture into the new sink, read it
back, and assert the event stream is **byte-identical** to the JSONL stream and that all five
reconciliation identities still hold. The Postgres test uses **`pg-mem`** (an in-memory Postgres)
so it runs offline with no Docker/server — copy that pattern:

```ts
// lib/__tests__/pg-source.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonlEventSource } from "../observation/jsonl-source";
import { PostgresEventSource } from "../observation/pg-source";
import { computeSummary } from "../analytics/overview";
import { computeModelAnalytics } from "../analytics/models";
import { assertReconciles } from "./reconcile";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const jsonl = path.join(FIXTURES, "reconcile-events.jsonl");

describe("PostgresEventSource (storage swap, zero analytics change)", () => {
  it("reads events identical to the JSONL sink", async () => {
    // ingestJsonlToPostgres(jsonl, dsn) — your write path, mirroring ingestJsonlToDuckDb
    const fromJsonl = (await new JsonlEventSource(jsonl).read()).events;
    const fromPg = (await new PostgresEventSource(testDsn).read()).events;

    expect(fromPg.length).toBe(fromJsonl.length);
    // The core identity: same events ⇒ same analytics input (SC-014).
    expect(JSON.stringify(fromPg)).toBe(JSON.stringify(fromJsonl));
  });

  it("the five reconciliation identities hold over the new sink", async () => {
    const events = (await new PostgresEventSource(testDsn).read()).events;
    const global = computeSummary(events).costByCurrency.USD;
    const ma = computeModelAnalytics(events);
    assertReconciles(ma.models, global, "Σ model == global (postgres)");
    assertReconciles(ma.providers, global, "Σ provider == global (postgres)");
    // ...and Σ prompt + unattributed, Σ workflow, Σ agent rollups (see reconcile.ts)
  });

  it("treats an absent/empty store as cold start, not an error", async () => {
    const res = await new PostgresEventSource(emptyDsn).read();
    expect(res.present).toBe(false);
    expect(res.events).toEqual([]);
  });
});
```

The five reconciliation identities (locked constraint #5, automated in
`lib/__tests__/reconcile.ts`) are: **Σ prompt + unattributed = global, Σ workflow =
global, Σ provider = global, Σ model = global, Σ agent rollups = global**. Use
`assertReconciles` (decimal cost) and `assertTokensReconcile` (integer tokens) from that
helper — don't reinvent the math.

The `JSON.stringify(yourEvents) === JSON.stringify(jsonlEvents)` assertion is the whole
game: if it passes, every downstream analytic is provably identical and you don't need to
re-test the aggregators. Run offline, no API key required.

---

## 5. Checklist

**Do**

- [ ] Implement all three methods: `read()`, `fingerprint()`, `describe()`.
- [ ] Push every raw record through `normalize()` — never construct an `ObservationEvent` by hand.
- [ ] Dedupe with `dedupeEvents()` and report `duplicates`.
- [ ] Sort with `sortEvents()` (timestamp, then `event_id`) before returning.
- [ ] Skip-and-count malformed/un-normalizable records as `skipped`; never throw on one bad record.
- [ ] Return `present: false` with empty `events` for a missing/empty store (cold start).
- [ ] Make `fingerprint()` cheap and change-sensitive; return `"absent"` when the source doesn't exist.
- [ ] Lazily `import()` the driver (mirror `db-source.ts`) so the default path never loads it.
- [ ] Register the source in `getEventSource()` behind a new `EVENT_SOURCE` value.
- [ ] Add native drivers to `serverExternalPackages` in `next.config.ts`.
- [ ] Add a test asserting `JSON.stringify(yourEvents) === JSON.stringify(jsonlEvents)` plus reconciliation.
- [ ] Mark the module `import "server-only"`.

**Don't**

- [ ] Don't mutate the source in `read()`/`fingerprint()` — keep writes/ingest in a separate function (READ-ONLY, Constitution III).
- [ ] Don't put secrets (passwords, tokens) in `describe()`.
- [ ] Don't reimplement `sortEvents`/`dedupeEvents`/`normalize` — import them.
- [ ] Don't change any aggregator in `lib/analytics/` — if you're tempted to, the seam is leaking.
- [ ] Don't throw when the store is empty or a single record is malformed.
- [ ] Don't guess attribution or invent fields; `normalize()` derives `attribution_status` and `event_id` deterministically.
- [ ] Don't eagerly import a native/optional driver at module top level.
