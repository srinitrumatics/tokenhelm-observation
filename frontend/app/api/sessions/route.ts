import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { filterByRange } from "@/lib/analytics/overview";
import { computeSessionExplorer, computeSession } from "@/lib/analytics/sessions";

/**
 * GET /api/sessions — Session Explorer (US4).
 * Contract: specs/002-ai-observability-platform/contracts/rest-api.md
 *
 *   ?from=&to=        optional date-range filter (FR-012)
 *   (no session)      → session list + session analytics
 *   ?session=<id>     → reconstructed session (summary, timeline, execution trace)
 *
 * Storage-agnostic: reconstructs from ObservationEvents only; ordering comes from
 * timestamps + event relationships, never UI state.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const session = url.searchParams.get("session");

    const source = getEventSource();
    const { events, skipped, duplicates, present, source: src } = await source.read();
    const scoped = filterByRange(events, from, to);
    const meta = { source: src, present, skipped, duplicates, generatedAt: new Date().toISOString() };

    if (session) {
      return NextResponse.json(
        { session: computeSession(scoped, session), meta },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { explorer: computeSessionExplorer(scoped), meta },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
