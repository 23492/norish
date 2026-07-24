/**
 * Ingredient density table — config-as-code, distilled from USDA FoodData Central
 * household-portion data (public domain / CC0) with a few well-established
 * culinary references (King Arthur Baking ingredient weight chart) where noted.
 *
 * Used ONLY for volume↔weight conversion (e.g. `cup` of flour → `gram`). Every
 * entry records the SOURCE figure it was derived from (grams per US customary
 * cup) so the number is auditable — nothing here is invented. If an ingredient is
 * not in this table, the converter FLAGS the measure as `unknown-density` and the
 * caller preserves it as authored. NEVER add a guessed density: add a real,
 * cited figure or leave it out.
 *
 * Density is stored as grams per millilitre (g/mL), derived from the cited
 * grams-per-cup using the US customary cup used by the `convert` package:
 *   1 US customary cup = 236.588236 mL.
 * Water is definitional (1.000 g/mL). Sources are attached per entry.
 *
 * Extensible by design: append entries; matching is longest-alias-first and
 * conservative (see `ingredient-density.ts`).
 */

/** US customary cup in millilitres — matches `convert(1,'cup').to('ml')`. */
export const CUP_ML = 236.588236;

export interface DensityEntry {
  /** Canonical ingredient key. */
  id: string;
  /** Normalized match aliases (lowercase). Includes the id's normalized form.
   * Single-word aliases only match a full normalized name; multi-word aliases
   * match as a whole-word phrase (see `ingredient-density.ts`). */
  aliases: string[];
  /** Density in grams per millilitre. */
  gramsPerMilliliter: number;
  /** The cited figure this density was derived from (grams per US cup). */
  gramsPerCup: number;
  /** Citation for the source figure. */
  source: string;
}

/** Build an entry from a cited grams-per-US-cup figure. */
function fromCup(
  id: string,
  gramsPerCup: number,
  source: string,
  aliases: string[]
): DensityEntry {
  return {
    id,
    aliases: Array.from(new Set([id.replace(/_/g, " "), ...aliases])),
    gramsPerMilliliter: gramsPerCup / CUP_ML,
    gramsPerCup,
    source,
  };
}

const USDA = "USDA FoodData Central (foodPortions.gramWeight, public domain/CC0)";
const KAB = "King Arthur Baking — Ingredient Weight Chart";

/**
 * The table. Coverage targets the common cooking ingredients whose recipes are
 * routinely authored in volume in the US and weight in metric: flours, sugars,
 * fats, dairy/liquids, salt, rice, leaveners, plus a few common others.
 */
export const DENSITY_TABLE: readonly DensityEntry[] = [
  // ── water & thin liquids (physical densities) ──
  {
    id: "water",
    aliases: ["water"],
    gramsPerMilliliter: 1.0, // definitional
    gramsPerCup: CUP_ML, // 236.59 g
    source: "Definitional: water density 1.000 g/mL",
  },

  // ── flours & starches ──
  fromCup("all_purpose_flour", 125, USDA, [
    "flour",
    "all purpose flour",
    "all-purpose flour",
    "plain flour",
    "white flour",
    "wheat flour",
  ]),
  fromCup("bread_flour", 120, KAB, ["bread flour"]),
  fromCup("cake_flour", 120, KAB, ["cake flour"]),
  fromCup("whole_wheat_flour", 120, USDA, ["whole wheat flour", "wholemeal flour"]),
  fromCup("cornstarch", 128, USDA, ["cornstarch", "corn starch", "cornflour", "corn flour"]),
  fromCup("cocoa_powder", 86, USDA, ["cocoa", "cocoa powder", "unsweetened cocoa"]),
  fromCup("rolled_oats", 90, USDA, ["oats", "rolled oats", "old fashioned oats", "porridge oats"]),
  fromCup("breadcrumbs", 108, USDA, ["breadcrumbs", "bread crumbs", "dry breadcrumbs"]),

  // ── sugars ──
  fromCup("granulated_sugar", 200, USDA, [
    "sugar",
    "granulated sugar",
    "white sugar",
    "caster sugar",
    "castor sugar",
    "superfine sugar",
  ]),
  fromCup("brown_sugar", 220, USDA, [
    "brown sugar",
    "packed brown sugar",
    "light brown sugar",
    "dark brown sugar",
  ]),
  fromCup("powdered_sugar", 120, USDA, [
    "powdered sugar",
    "confectioners sugar",
    "confectioners' sugar",
    "icing sugar",
  ]),

  // ── fats & oils ──
  fromCup("butter", 227, USDA, ["butter", "unsalted butter", "salted butter"]),
  fromCup("vegetable_oil", 218, USDA, [
    "oil",
    "vegetable oil",
    "canola oil",
    "sunflower oil",
    "cooking oil",
  ]),
  fromCup("olive_oil", 216, USDA, ["olive oil", "extra virgin olive oil"]),

  // ── dairy & wet ──
  fromCup("milk", 244, USDA, ["milk", "whole milk", "cow milk"]),
  fromCup("heavy_cream", 238, USDA, ["heavy cream", "double cream", "whipping cream"]),
  fromCup("sour_cream", 230, USDA, ["sour cream"]),
  fromCup("yogurt", 245, USDA, ["yogurt", "yoghurt", "plain yogurt", "greek yogurt"]),

  // ── syrups & spreads ──
  fromCup("honey", 340, USDA, ["honey"]),
  fromCup("maple_syrup", 322, USDA, ["maple syrup"]),
  fromCup("peanut_butter", 258, USDA, ["peanut butter"]),

  // ── salt & leaveners ──
  fromCup("table_salt", 292, USDA, ["salt", "table salt", "fine salt", "sea salt"]),
  fromCup("kosher_salt", 128, KAB, ["kosher salt"]), // Diamond Crystal; brand-variable
  fromCup("baking_soda", 220, USDA, ["baking soda", "bicarbonate of soda", "sodium bicarbonate"]),
  fromCup("baking_powder", 221, USDA, ["baking powder"]),

  // ── grains ──
  fromCup("white_rice", 185, USDA, ["rice", "white rice", "long grain rice", "uncooked rice"]),

  // ── produce ──
  fromCup("chopped_onion", 160, USDA, ["chopped onion", "diced onion"]),
  fromCup("grated_parmesan", 100, USDA, ["grated parmesan", "parmesan", "parmesan cheese"]),
];
