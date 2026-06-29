import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { findRecommendation } from "@/lib/analytics/recommendations";

/** GET /api/recommendations/{id} — a single recommendation by id (US6). */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { events } = await getEventSource().read();
    const recommendation = findRecommendation(events, decodeURIComponent(id));
    if (!recommendation) {
      return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    }
    return NextResponse.json(
      { recommendation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
