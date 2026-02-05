import type { UnitsMap, FlatUnitsMap } from "@/server/db/zodSchemas/server-config";

/**
 * Flatten locale-aware units config to flat format for parse-ingredient library.
 * Uses the first locale's short and plural forms as defaults.
 */
export function flattenForLibrary(config: UnitsMap): FlatUnitsMap {
  const flattened: FlatUnitsMap = {};

  for (const [unitId, unitDef] of Object.entries(config)) {
    flattened[unitId] = {
      short: unitDef.short[0]?.name || unitId,
      plural: unitDef.plural[0]?.name || unitId,
      alternates: unitDef.alternates,
    };
  }

  return flattened;
}

/**
 * Format a unit for display based on user's locale.
 * Always uses the short/abbreviated form for consistency (e.g., "g", "tbsp", "tsp").
 *
 * @param unitId - The canonical English unit ID (e.g., "gram", "tablespoon")
 * @param userLocale - User's locale (e.g., "en", "de-formal", "nl")
 * @param config - The locale-aware units configuration
 * @returns The localized unit name
 *
 * @example
 * formatUnit("gram", "en", config) → "g"
 * formatUnit("tablespoon", "de-formal", config) → "EL" (matches base "de")
 */
export function formatUnit(unitId: string, userLocale: string, config: UnitsMap): string {
  const unitDef = config[unitId];
  if (!unitDef) return unitId; // Unknown unit, return as-is

  // Always use short form for consistent abbreviated display
  const forms = unitDef.short;

  // Try exact match first (e.g., "de-formal")
  const exactMatch = forms.find((f) => f.locale === userLocale);
  if (exactMatch) return exactMatch.name;

  // Try base locale match (e.g., "de" for "de-formal" or "de-informal")
  const baseLocale = userLocale.split("-")[0];
  if (baseLocale !== userLocale) {
    const baseMatch = forms.find(
      (f) => f.locale === baseLocale || f.locale.startsWith(baseLocale + "-")
    );
    if (baseMatch) return baseMatch.name;
  }

  // Fallback to English
  const en = forms.find((f) => f.locale === "en");
  if (en) return en.name;

  // Last resort: first available
  return forms[0]?.name || unitId;
}
