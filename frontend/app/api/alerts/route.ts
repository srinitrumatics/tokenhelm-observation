import { NextResponse } from "next/server";
import { getEventSource } from "@/lib/observation/source";
import { filterByRange } from "@/lib/analytics/overview";
import { computeAlerts } from "@/lib/analytics/alerts";
import { alertStore } from "@/lib/alert-state";

/**
 * GET /api/alerts — rule-based operational alerts with lifecycle overlay (US6).
 *   ?from=&to=       optional date-range filter
 *   ?severity=       optional severity filter
 *   ?entity_type=    optional entity-type filter
 *   ?status=         optional lifecycle filter (active|acknowledged|resolved)
 * Alerts are recomputed from immutable events on every request; the acknowledged/
 * resolved overlay comes from the process-local alert store (never the event log).
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const severity = url.searchParams.get("severity");
    const entityType = url.searchParams.get("entity_type");
    const status = url.searchParams.get("status");

    const { events, skipped, duplicates, present, source } = await getEventSource().read();
    const scoped = filterByRange(events, from, to);

    let alerts = alertStore.apply(computeAlerts(scoped));
    if (severity) alerts = alerts.filter((a) => a.severity === severity);
    if (entityType) alerts = alerts.filter((a) => a.entity_type === entityType);
    if (status) alerts = alerts.filter((a) => a.status === status);

    const meta = { source, present, skipped, duplicates, generatedAt: new Date().toISOString() };
    return NextResponse.json(
      { alerts, meta },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read event source";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
