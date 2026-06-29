"use client";

import { useCallback, useEffect, useState } from "react";
import type { ObservationApiResponse } from "./observation/api";

export interface UseObservationsState {
  data: ObservationApiResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Client hook that fetches GET /api/overview once and exposes the normalized
 * ObservationEvents + meta, plus refresh() (FR-012, SC-007). Uses no-store so each
 * refresh reflects newly appended events. The page recomputes all views in-memory.
 */
export function useObservations(): UseObservationsState {
  const [data, setData] = useState<ObservationApiResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/overview", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const json = (await res.json()) as ObservationApiResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load observability data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
