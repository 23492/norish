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
 * neutral prep descriptors stripped, whitespace collapsed. Identity-bearing
 * words (whole, brown, white, ground, …) are kept.
 *
 * The stopword list is BILINGUAL (English + Dutch, Phase 27 W5-PREP) — this
 * fork's live install is authored in Dutch, and `27-W5-PREP-DENSITY-MEASUREMENT.md`
 * found most Dutch density misses were an English-only prep-word list stripping
 * nothing from a Dutch name, not a missing USDA figure. `kokend` (boiling) and
 * `vloeibaar`/`vloeibare` (liquid) have no direct English-list counterpart and
 * were added because the measurement named them (`kokend water`, `vloeibare
 * honing`).
 */

const PREP_DESCRIPTORS = new Set([
  // ── English ──
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
  // ── Dutch (Phase 27 W5-PREP, D-27-W5P-07) ──
  "vers",
  "verse",
  "biologisch",
  "biologische",
  "rauw",
  "rauwe",
  "gehakt",
  "gehakte",
  "fijngehakt",
  "fijngehakte",
  "gesneden",
  "geplet",
  "geplette",
  "gesmolten",
  "gesnipperd",
  "gesnipperde",
  "geraspt",
  "geraspte",
  "koud",
  "koude",
  "warme",
  "heet",
  "hete",
  "zacht",
  "zachte",
  "kokend",
  "kokende",
  "vloeibaar",
  "vloeibare",
  "kamertemperatuur",
  "kopje",
  "kopjes",
  "eetlepel",
  "eetlepels",
  "theelepel",
  "theelepels",
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
