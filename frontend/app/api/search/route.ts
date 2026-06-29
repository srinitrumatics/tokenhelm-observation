import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { filterByRange } from "@/lib/analytics/overview";
import { search } from "@/lib/analytics/search";

/**
 * GET /api/search?q=&from=&to=&limit= — cross-entity search (US-Polish, FR-027).
 * Searches prompts/agents/workflows/sessions/models/providers; read-only over events.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const limitRaw = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;

    const { events, present, source } = await getEventSource().read();
    const scoped = filterByRange(events, from, to);
    const results = search(scoped, q, limit);

    return NextResponse.json(
      { query: q, results, meta: { source, present, count: results.length, generatedAt: new Date().toISOString() } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
