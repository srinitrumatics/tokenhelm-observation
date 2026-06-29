import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { computeAlerts } from "@/lib/analytics/alerts";
import { alertStore } from "@/lib/alert-state";

/** GET /api/alerts/{id} — a single alert (with lifecycle overlay) by id (US6). */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const alertId = decodeURIComponent(id);
    const { events } = await getEventSource().read();
    const alert = alertStore.apply(computeAlerts(events)).find((a) => a.alert_id === alertId);
    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }
    return NextResponse.json({ alert }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
