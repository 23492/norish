/**
 * Pure ingredient-token helpers shared by the render-side markup layer
 * (`@norish/shared-react/text/ingredient-links`) and the Cooklang serializer
 * (`@norish/shared/cooklang`).
 *
 * They live here because `@norish/shared` cannot import `@norish/shared-react`
 * (`pnpm deps:cycles` forbids the edge). Moved down verbatim from
 * `ingredient-links.ts` in Phase 27 W1 (D-27-W1-04) — zero behaviour change.
 */

export function normalizeIngredientLinkName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Format a structured amount for display and for a `{amount%unit}` token body.
 *
 * A BLANK amount is NO amount, not zero (Phase 27 W3B, H2). `Number(" ")` is `0`, so
 * a whitespace-only amount used to format as `"0"` — which rendered "0 gram of
 * flour" on the read side and emitted `@flour{0%gram}` into the `.cook`, inventing a
 * quantity the extraction never carried. It is treated exactly like `""` now: the
 * token degrades to its amount-less form and the reference is kept.
 */
export function formatTokenAmount(amount: number | string | null | undefined): string {
  if (amount == null || (typeof amount === "string" && amount.trim() === "")) return "";

  const numberAmount = typeof amount === "string" ? Number(amount) : amount;

  if (!Number.isFinite(numberAmount)) return String(amount).trim();
  if (Number.isInteger(numberAmount)) return String(numberAmount);

  return String(numberAmount).replace(/\.?0+$/, "");
}
