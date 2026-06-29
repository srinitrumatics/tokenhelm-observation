"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageApiResponse } from "./schema";

export interface UseUsageState {
  data: UsageApiResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Client hook that fetches GET /api/usage and exposes records + summary + meta,
 * plus a refresh() that re-reads the log (FR-012). Uses no-store so each refresh
 * reflects the current file contents.
 */
export function useUsage(): UseUsageState {
  const [data, setData] = useState<UsageApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const json = (await res.json()) as UsageApiResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
