import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { filterByRange } from "@/lib/analytics/overview";
import {
  computePromptLeaderboard,
  computePromptDetail,
  computePromptFlags,
} from "@/lib/analytics/prompts";

/**
 * GET /api/prompts — Prompt analytics (US2).
 * Contract: specs/002-ai-observability-platform/contracts/rest-api.md
 *
 *   ?from=&to=         optional date-range filter (FR-012)
 *   (no prompt)        → leaderboard + recommendation flags
 *   ?prompt=<name>     → detail (timeline, executions, trend, versions, attribution)
 *
 * Storage-agnostic: reads via the EventSource and computes over ObservationEvents
 * only. Never mutates the source (Constitution III).
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const prompt = url.searchParams.get("prompt");

    const source = getEventSource();
    const { events, skipped, duplicates, present, source: src } = await source.read();
    const scoped = filterByRange(events, from, to);

    const meta = {
      source: src,
      present,
      skipped,
      duplicates,
      generatedAt: new Date().toISOString(),
    };

    if (prompt) {
      return NextResponse.json(
        { detail: computePromptDetail(scoped, prompt), meta },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const leaderboard = computePromptLeaderboard(scoped);
    return NextResponse.json(
      { leaderboard, flags: computePromptFlags(leaderboard), meta },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
