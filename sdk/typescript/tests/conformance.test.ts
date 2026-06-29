/**
 * Cross-language conformance: the TypeScript validator must agree with the shared
 * `protocol/conformance` fixtures — the SAME cases the Python SDK and the `observe` CLI run.
 * A divergence here means a producer would disagree with the protocol — a release-blocker.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ProtocolValidationError, validate } from "../src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tests → typescript → sdk → repo root
const CONFORMANCE = path.resolve(HERE, "..", "..", "..", "protocol", "conformance");

interface Case {
  file: string;
  valid: boolean;
  rule?: string;
  match?: string;
}

const cases: Case[] = JSON.parse(readFileSync(path.join(CONFORMANCE, "manifest.json"), "utf8")).cases;

function loadCase(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(CONFORMANCE, rel), "utf8"));
}

describe("Observation Protocol v1 conformance (shared fixtures)", () => {
  for (const c of cases) {
    it(`${c.valid ? "accepts" : "rejects"} ${c.file}`, () => {
      const event = loadCase(c.file);
      if (c.valid) {
        expect(() => validate(event)).not.toThrow();
      } else {
        let err: unknown;
        try {
          validate(event);
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(ProtocolValidationError);
        expect((err as Error).message).toContain(c.match!);
      }
    });
  }

  it("manifest references every fixture on disk (no orphans)", () => {
    const referenced = new Set(cases.map((c) => c.file.replace(/\\/g, "/")));
    const onDisk = new Set<string>();
    for (const sub of ["valid", "invalid"]) {
      for (const name of readdirSync(path.join(CONFORMANCE, sub))) {
        if (name.endsWith(".json")) onDisk.add(`${sub}/${name}`);
      }
    }
    expect([...onDisk].sort()).toEqual([...referenced].sort());
  });
});
