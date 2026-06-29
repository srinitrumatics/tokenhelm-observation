/**
 * Transport abstraction — how emitted events leave the producer.
 *
 * The SDK emits through a `Transport` rather than writing to storage directly, so it stays
 * independent of the platform's storage layer while remaining compatible with the EventSource
 * architecture (the JSONL transport writes exactly the append-only format an EventSource reads).
 */

import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import type { ObservationEvent } from "./protocol.js";

/** Sink for protocol-valid ObservationEvents. Implementations MUST NOT mutate the event. */
export interface Transport {
  emit(event: ObservationEvent): void;
  flush?(): void | Promise<void>;
  close?(): void | Promise<void>;
}

/** Collects events in an array — for tests and in-process inspection. */
export class InMemoryTransport implements Transport {
  readonly events: ObservationEvent[] = [];

  emit(event: ObservationEvent): void {
    // Store a copy so a later mutation of the caller's object can't change history.
    this.events.push({ ...event });
  }
}

export interface JsonlTransportOptions {
  /** 'a' appends (default); 'w' truncates (e.g. when regenerating a fixture). */
  mode?: "a" | "w";
}

/**
 * Appends one JSON line per event — the format an EventSource reads (usage_log.jsonl).
 *
 * Append-only by default; pass `mode: 'w'` to truncate. Each write is flushed to the OS so a
 * crash never loses an acknowledged event. The producer never reads the file back — that is
 * the platform's job.
 */
export class JsonlTransport implements Transport {
  private readonly fd: number;
  private closed = false;

  constructor(path: string, options: JsonlTransportOptions = {}) {
    const mode = options.mode ?? "a";
    if (mode !== "a" && mode !== "w") {
      throw new Error("mode must be 'a' (append) or 'w' (truncate)");
    }
    this.fd = openSync(path, mode);
  }

  emit(event: ObservationEvent): void {
    // Compact JSON (no spaces) — byte-for-byte the same shape the Python JsonlTransport writes.
    writeSync(this.fd, JSON.stringify(event) + "\n");
    fsyncSync(this.fd);
  }

  flush(): void {
    if (!this.closed) fsyncSync(this.fd);
  }

  close(): void {
    if (this.closed) return;
    fsyncSync(this.fd);
    closeSync(this.fd);
    this.closed = true;
  }
}

export interface HttpTransportOptions {
  batchSize?: number;
  timeoutMs?: number;
}

/**
 * EXPERIMENTAL (v1.1+): POST events to a collector endpoint.
 *
 * Buffers events and flushes a batch via the global `fetch`. Provided as the forward-looking
 * transport from ADR 0002; not exercised by the offline test suite. `emit` buffers
 * synchronously and triggers a fire-and-forget send when the batch fills; call `await flush()`
 * to force a send and observe failures.
 */
export class HttpTransport implements Transport {
  private readonly url: string;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly buffer: ObservationEvent[] = [];

  constructor(url: string, options: HttpTransportOptions = {}) {
    this.url = url;
    this.batchSize = options.batchSize ?? 50;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  emit(event: ObservationEvent): void {
    this.buffer.push({ ...event });
    if (this.buffer.length >= this.batchSize) {
      void this.send().catch(() => {
        /* fire-and-forget on batch fill; use flush() to observe errors */
      });
    }
  }

  async flush(): Promise<void> {
    await this.send();
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private async send(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0, this.buffer.length);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
