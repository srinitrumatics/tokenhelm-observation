import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import type { ObservationApiResponse } from "@/lib/observation/api";

/**
 * GET /api/overview — read-only endpoint backing the observability dashboard.
 * Contract: specs/002-ai-observability-platform/contracts/rest-api.md
 *
 * Selects the active EventSource via getEventSource() (jsonl by default, duckdb when
 * EVENT_SOURCE=duckdb — swappable per constraint #2), reads normalized ObservationEvents fresh on every request
 * (no cache), and returns them with a meta block that surfaces skipped/duplicate
 * counts honestly (FR-029). Never mutates the source (Constitution III).
 *
 * The client recomputes KPIs/cost breakdowns in-memory per date range, so this
 * endpoint stays storage-agnostic and the analytics layer never parses JSONL here.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const source = getEventSource();
    const { events, skipped, duplicates, present, source: src } = await source.read();
    const body: ObservationApiResponse = {
      events,
      meta: {
        source: src,
        present,
        skipped,
        duplicates,
        generatedAt: new Date().toISOString(),
      },
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
