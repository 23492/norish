import type { DensityEntry } from "./density-table";

import { DENSITY_TABLE } from "./density-table";

/**
 * Robust-but-conservative ingredient-name → density lookup.
 *
 * Principle (D-units): a WRONG density match is worse than a flag. So:
 *   - single-word aliases ("flour", "sugar", "salt") match ONLY a full
 *     normalized name — so "coconut flour" (a flour we don't have) does NOT
 *     silently match all-purpose "flour"; it falls through to `unknown-density`;
 *   - multi-word aliases ("brown sugar", "all purpose flour") match as a
 *     whole-word phrase anywhere in the name;
 *   - among all matches, the LONGEST alias wins (longest-match — "brown sugar"
 *     beats "sugar", "whole wheat flour" beats "flour").
 *
 * Names are normalized first: lowercased, punctuation → spaces, a small set of
 * neutral prep descriptors (fresh/chopped/melted/…) stripped, whitespace
 * collapsed. Identity-bearing words (whole, brown, white, ground, …) are kept.
 */

const PREP_DESCRIPTORS = new Set([
  "fresh",
  "organic",
  "raw",
  "chopped",
  "diced",
  "minced",
  "sliced",
  "crushed",
  "melted",
  "softened",
  "cold",
  "warm",
  "hot",
  "room",
  "temperature",
  "of",
  "cups",
  "cup",
  "tbsp",
  "tsp",
]);

/** Normalize an ingredient name for density matching. */
export function normalizeIngredientName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .split(" ")
    .filter((w) => w.length > 0 && !PREP_DESCRIPTORS.has(w))
    .join(" ")
    .trim();
}

/** Does `alias` occur in `norm` as a whole-word phrase? */
function containsPhrase(norm: string, alias: string): boolean {
  if (alias === norm) return true;

  const padded = ` ${norm} `;

  return padded.includes(` ${alias} `);
}

/**
 * Find the density entry for an ingredient name, or null if none can be matched
 * confidently. Longest matching alias wins.
 */
export function findDensity(ingredientName: string | null | undefined): DensityEntry | null {
  if (!ingredientName) return null;

  const norm = normalizeIngredientName(ingredientName);

  if (!norm) return null;

  let best: DensityEntry | null = null;
  let bestLen = 0;

  for (const entry of DENSITY_TABLE) {
    for (const alias of entry.aliases) {
      const isMultiWord = alias.includes(" ");
      // Single-word aliases must match the whole name; multi-word aliases may
      // match as a whole-word phrase.
      const matched = isMultiWord ? containsPhrase(norm, alias) : norm === alias;

      if (matched && alias.length > bestLen) {
        best = entry;
        bestLen = alias.length;
      }
    }
  }

  return best;
}
