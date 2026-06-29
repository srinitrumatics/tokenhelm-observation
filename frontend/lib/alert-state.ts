import type { Alert, AlertStatus } from "./analytics/alerts";

/**
 * Alert lifecycle state store (US6). Alerts are *computed* fresh from immutable
 * ObservationEvents on every request; their lifecycle (acknowledged / resolved) is the
 * only mutable piece, and it lives HERE — keyed by the deterministic alert_id — so that
 * acknowledging or resolving an alert never modifies an ObservationEvent.
 *
 * The store maps alert_id -> lifecycle overlay. `apply()` merges the overlay onto freshly
 * computed alerts. Unknown ids are tolerated (an alert may have cleared between the action
 * and a later recompute) — the overlay simply finds no alert to attach to.
 */

export interface AlertStateEntry {
  status: AlertStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

export interface AlertStore {
  acknowledge(id: string, at: string): AlertStateEntry;
  resolve(id: string, at: string): AlertStateEntry;
  get(id: string): AlertStateEntry | undefined;
  apply(alerts: Alert[]): Alert[];
  reset(): void;
}

export function createAlertStore(): AlertStore {
  const map = new Map<string, AlertStateEntry>();

  return {
    acknowledge(id, at) {
      const prev = map.get(id);
      // Resolving is terminal; don't let a late acknowledge downgrade a resolved alert.
      if (prev?.status === "resolved") return prev;
      const entry: AlertStateEntry = {
        status: "acknowledged",
        acknowledged_at: at,
        resolved_at: prev?.resolved_at ?? null,
      };
      map.set(id, entry);
      return entry;
    },
    resolve(id, at) {
      const prev = map.get(id);
      const entry: AlertStateEntry = {
        status: "resolved",
        acknowledged_at: prev?.acknowledged_at ?? null,
        resolved_at: at,
      };
      map.set(id, entry);
      return entry;
    },
    get(id) {
      return map.get(id);
    },
    apply(alerts) {
      return alerts.map((a) => {
        const s = map.get(a.alert_id);
        if (!s) return a;
        return {
          ...a,
          status: s.status,
          acknowledged_at: s.acknowledged_at,
          resolved_at: s.resolved_at,
        };
      });
    },
    reset() {
      map.clear();
    },
  };
}

/**
 * Process-wide singleton used by the API routes. It persists across requests within a
 * running server process (lifecycle is intentionally ephemeral local state, not written
 * back to the immutable log). Tests use `createAlertStore()` for isolation.
 */
export const alertStore = createAlertStore();
