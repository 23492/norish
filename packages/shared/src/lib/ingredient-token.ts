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

export function formatTokenAmount(amount: number | string | null | undefined): string {
  if (amount == null || amount === "") return "";

  const numberAmount = typeof amount === "string" ? Number(amount) : amount;

  if (!Number.isFinite(numberAmount)) return String(amount).trim();
  if (Number.isInteger(numberAmount)) return String(numberAmount);

  return String(numberAmount).replace(/\.?0+$/, "");
}
