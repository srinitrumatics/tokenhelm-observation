import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { computeAlerts } from "@/lib/analytics/alerts";
import { alertStore } from "@/lib/alert-state";

/**
 * PATCH /api/alerts/{id}/resolve — move an alert to the "resolved" state (US6).
 * This mutates ONLY the alert lifecycle store; it never touches ObservationEvents.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const alertId = decodeURIComponent(id);
    const { events } = await getEventSource().read();
    const exists = computeAlerts(events).some((a) => a.alert_id === alertId);
    if (!exists) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }
    alertStore.resolve(alertId, new Date().toISOString());
    const alert = alertStore.apply(computeAlerts(events)).find((a) => a.alert_id === alertId);
    return NextResponse.json({ alert }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve alert";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
