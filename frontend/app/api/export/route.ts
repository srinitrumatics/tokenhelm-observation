import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { filterByRange } from "@/lib/analytics/overview";
import { exportView, toCsv, EXPORT_VIEWS, type ExportView } from "@/lib/analytics/export";

/**
 * GET /api/export?view=&format=json|csv&from=&to= — export a computed view (FR-028).
 * Read-only over events. CSV is returned as a file attachment.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") as ExportView | null;
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!view || !EXPORT_VIEWS.includes(view)) {
      return NextResponse.json(
        { error: `Unknown view. Use one of: ${EXPORT_VIEWS.join(", ")}` },
        { status: 400 },
      );
    }

    const { events } = await getEventSource().read();
    const scoped = filterByRange(events, from, to);
    const t = exportView(scoped, view);

    if (format === "csv") {
      return new NextResponse(toCsv(t), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${view}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(t, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to export";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
