import Decimal from "decimal.js";

/**
 * Shared reconciliation assertion helper (locked constraint #5). The five identities
 * — Σ prompt + unattributed = global, Σ workflow = global, Σ provider = global,
 * Σ model = global, Σ agent rollups = global — are AUTOMATED here, not documented.
 *
 * Used by per-story reconciliation tests (overview/prompts/agents/workflows) and the
 * consolidated reconcile.test.ts.
 */

export function sumCost(groups: Array<{ cost: string }>): string {
  return groups
    .reduce((acc, g) => acc.plus(new Decimal(g.cost || "0")), new Decimal(0))
    .toString();
}

/** True iff Σ(group costs) equals the global cost exactly (decimal). */
export function reconciles(groups: Array<{ cost: string }>, globalCost: string): boolean {
  return new Decimal(sumCost(groups)).equals(new Decimal(globalCost || "0"));
}

/** Throw a descriptive error if a reconciliation identity does not hold. */
export function assertReconciles(
  groups: Array<{ cost: string }>,
  globalCost: string,
  label: string,
): void {
  const sum = sumCost(groups);
  if (!new Decimal(sum).equals(new Decimal(globalCost || "0"))) {
    throw new Error(`Reconciliation failed [${label}]: Σ groups = ${sum} != global ${globalCost}`);
  }
}

/** Σ(group totalTokens) — integer token reconciliation. */
export function sumTokens(groups: Array<{ totalTokens: number }>): number {
  return groups.reduce((acc, g) => acc + g.totalTokens, 0);
}

/** Throw if Σ(group tokens) != global tokens (constraint #5, token identity). */
export function assertTokensReconcile(
  groups: Array<{ totalTokens: number }>,
  globalTokens: number,
  label: string,
): void {
  const sum = sumTokens(groups);
  if (sum !== globalTokens) {
    throw new Error(`Token reconciliation failed [${label}]: Σ groups = ${sum} != global ${globalTokens}`);
  }
}
