import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { filterByRange } from "@/lib/analytics/overview";
import { computeRecommendations } from "@/lib/analytics/recommendations";

/**
 * GET /api/recommendations — rule-based optimization recommendations (US6).
 *   ?from=&to=     optional date-range filter
 *   ?category=     optional category filter
 *   ?severity=     optional severity filter
 * Recommendations are derived purely from the validated analytics flags; this route
 * never mutates the event log.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const category = url.searchParams.get("category");
    const severity = url.searchParams.get("severity");

    const { events, skipped, duplicates, present, source } = await getEventSource().read();
    const scoped = filterByRange(events, from, to);

    let recommendations = computeRecommendations(scoped);
    if (category) recommendations = recommendations.filter((r) => r.category === category);
    if (severity) recommendations = recommendations.filter((r) => r.severity === severity);

    const meta = { source, present, skipped, duplicates, generatedAt: new Date().toISOString() };
    return NextResponse.json(
      { recommendations, meta },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
