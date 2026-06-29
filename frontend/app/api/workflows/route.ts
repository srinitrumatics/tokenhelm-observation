import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { filterByRange } from "@/lib/analytics/overview";
import {
  computeWorkflowLeaderboard,
  computeWorkflowDetail,
  computeWorkflowFlags,
} from "@/lib/analytics/workflows";

/**
 * GET /api/workflows — Workflow analytics (US5).
 *   ?from=&to=        optional date-range filter
 *   (no workflow)     → leaderboard + recommendation flags
 *   ?workflow=<id>    → detail (graph, trace, participation, trends)
 * Contract: specs/002-ai-observability-platform/contracts/rest-api.md
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const workflow = url.searchParams.get("workflow");

    const source = getEventSource();
    const { events, skipped, duplicates, present, source: src } = await source.read();
    const scoped = filterByRange(events, from, to);
    const meta = { source: src, present, skipped, duplicates, generatedAt: new Date().toISOString() };

    if (workflow) {
      return NextResponse.json(
        { detail: computeWorkflowDetail(scoped, workflow), meta },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const leaderboard = computeWorkflowLeaderboard(scoped);
    return NextResponse.json(
      { leaderboard, flags: computeWorkflowFlags(leaderboard, scoped), meta },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
