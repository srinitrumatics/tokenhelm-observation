import { NextResponse } from "next/server";
import { readUsageLog } from "@/lib/usage-log";
import { computeSummary } from "@/lib/aggregate";
import type { UsageApiResponse } from "@/lib/schema";

/**
 * GET /api/usage — read-only endpoint backing the dashboard.
 * Contract: specs/001-cost-analytics-dashboard/contracts/usage-api.md
 *
 * Reads the log fresh on every request (no cache) so newly appended calls appear
 * on refresh (FR-012). Never mutates the source file (Constitution III).
 */

// Always read fresh from disk; do not statically cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { records, skippedLines, logPresent, source } = await readUsageLog();
    const summary = computeSummary(records, skippedLines);
    const body: UsageApiResponse = {
      records,
      summary,
      meta: { source, logPresent },
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read usage log";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
