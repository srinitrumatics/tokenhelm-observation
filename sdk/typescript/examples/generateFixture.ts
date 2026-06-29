/**
 * Generate the TypeScript-SDK-emitted fixture the platform's cross-stack parity test consumes.
 *
 * Writes the research-pipeline scenario (see scenario.ts) to
 * `frontend/lib/__tests__/fixtures/sdk-emitted-events.typescript.jsonl` via the JSONL transport
 * — the same append-only format an EventSource reads. The platform test
 * `frontend/lib/__tests__/sdk-parity.test.ts` then proves identical analytics AND field-for-field
 * parity with the Python-emitted fixture (only `metadata.sdk` differs).
 *
 *     npm run gen:fixture            # build, then write to the default path
 *     node dist/examples/generateFixture.js [outputPath]
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ObservationClient } from "../src/client.js";
import { JsonlTransport } from "../src/transport.js";
import { emitScenario } from "./scenario.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Find the repo root by ascending until a directory holds both `sdk/` and `frontend/`.
 * Robust whether this runs from source (`examples/`) or compiled (`dist/examples/`).
 */
function repoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, "sdk")) && existsSync(path.join(dir, "frontend"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("could not locate repo root (no sdk/ + frontend/ above " + start + ")");
    dir = parent;
  }
}

const DEFAULT_OUT = path.join(
  repoRoot(HERE),
  "frontend", "lib", "__tests__", "fixtures", "sdk-emitted-events.typescript.jsonl",
);

/** Write the scenario to `outPath` (mode 'w', deterministic). Returns the event count. */
export function writeFixture(outPath: string): number {
  const client = new ObservationClient(new JsonlTransport(outPath, { mode: "w" }), {
    applicationName: "research-pipeline-demo",
    environment: "demo",
  });
  try {
    return emitScenario(client).length;
  } finally {
    void client.close();
  }
}

function main(): void {
  const outPath = process.argv[2] ?? DEFAULT_OUT;
  const n = writeFixture(outPath);
  console.log(`Wrote ${n} SDK-emitted ObservationEvents to ${outPath}`);
}

// Run main() only when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
