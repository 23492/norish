import { describe, expect, it } from "vitest";

import { DENSITY_TABLE, findDensity, normalizeIngredientName } from "@norish/shared/units";

/**
 * Phase 27 W5-PREP, Deliverable 3 — the Dutch alias + prep-stopword pass over
 * `density-table.ts` / `ingredient-density.ts`.
 *
 * Order matters here (matches the plan): the invariant and the frozen maps
 * come FIRST — they are the regression proof and the belt-and-braces guard
 * that no pre-existing English alias silently re-points or stops resolving —
 * and the Dutch additions come SECOND.
 */

describe("full-table alias-reachability invariant — the English regression proof", () => {
  it("every entry's every alias resolves back to that same entry's id", () => {
    // Iterates the REAL table at runtime — not a hand-written list. On the
    // pre-change tree this FAILS for `chopped_onion`: both its aliases
    // ("chopped onion", "diced onion") begin with a word `PREP_DESCRIPTORS`
    // strips, so they can never appear in a normalized name
    // (D-27-W5P-07). It is fixed by adding the single-word `onion`/`ui`
    // aliases in this same task — proving no pre-existing alias stopped
    // resolving or got re-pointed, and no newly added Dutch stopword
    // destroyed one either.
    const failures: string[] = [];

    for (const entry of DENSITY_TABLE) {
      for (const alias of entry.aliases) {
        const match = findDensity(alias);

        if (match?.id !== entry.id) {
          failures.push(`${JSON.stringify(alias)} -> ${match?.id ?? "null"} (expected ${entry.id})`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

describe("frozen pre-change English alias -> entry-id map (belt to the invariant's braces)", () => {
  // The invariant above would still pass if an entry's WHOLE alias set were
  // swapped with another entry's (both would still resolve to "their own"
  // entry, just the wrong one relative to before this task). This frozen map,
  // captured from the tree BEFORE any Task 4 edit, would not.
  const FROZEN_ALIAS_MAP: ReadonlyArray<readonly [string, string]> = [
    ["water", "water"],
    ["all purpose flour", "all_purpose_flour"],
    ["flour", "all_purpose_flour"],
    ["all-purpose flour", "all_purpose_flour"],
    ["plain flour", "all_purpose_flour"],
    ["white flour", "all_purpose_flour"],
    ["wheat flour", "all_purpose_flour"],
    ["bread flour", "bread_flour"],
    ["cake flour", "cake_flour"],
    ["whole wheat flour", "whole_wheat_flour"],
    ["wholemeal flour", "whole_wheat_flour"],
    ["cornstarch", "cornstarch"],
    ["corn starch", "cornstarch"],
    ["cornflour", "cornstarch"],
    ["corn flour", "cornstarch"],
    ["cocoa powder", "cocoa_powder"],
    ["cocoa", "cocoa_powder"],
    ["unsweetened cocoa", "cocoa_powder"],
    ["rolled oats", "rolled_oats"],
    ["oats", "rolled_oats"],
    ["old fashioned oats", "rolled_oats"],
    ["porridge oats", "rolled_oats"],
    ["breadcrumbs", "breadcrumbs"],
    ["bread crumbs", "breadcrumbs"],
    ["dry breadcrumbs", "breadcrumbs"],
    ["granulated sugar", "granulated_sugar"],
    ["sugar", "granulated_sugar"],
    ["white sugar", "granulated_sugar"],
    ["caster sugar", "granulated_sugar"],
    ["castor sugar", "granulated_sugar"],
    ["superfine sugar", "granulated_sugar"],
    ["brown sugar", "brown_sugar"],
    ["packed brown sugar", "brown_sugar"],
    ["light brown sugar", "brown_sugar"],
    ["dark brown sugar", "brown_sugar"],
    ["powdered sugar", "powdered_sugar"],
    ["confectioners sugar", "powdered_sugar"],
    ["confectioners' sugar", "powdered_sugar"],
    ["icing sugar", "powdered_sugar"],
    ["butter", "butter"],
    ["unsalted butter", "butter"],
    ["salted butter", "butter"],
    ["vegetable oil", "vegetable_oil"],
    ["oil", "vegetable_oil"],
    ["canola oil", "vegetable_oil"],
    ["sunflower oil", "vegetable_oil"],
    ["cooking oil", "vegetable_oil"],
    ["olive oil", "olive_oil"],
    ["extra virgin olive oil", "olive_oil"],
    ["milk", "milk"],
    ["whole milk", "milk"],
    ["cow milk", "milk"],
    ["heavy cream", "heavy_cream"],
    ["double cream", "heavy_cream"],
    ["whipping cream", "heavy_cream"],
    ["sour cream", "sour_cream"],
    ["yogurt", "yogurt"],
    ["yoghurt", "yogurt"],
    ["plain yogurt", "yogurt"],
    ["greek yogurt", "yogurt"],
    ["honey", "honey"],
    ["maple syrup", "maple_syrup"],
    ["peanut butter", "peanut_butter"],
    ["table salt", "table_salt"],
    ["salt", "table_salt"],
    ["fine salt", "table_salt"],
    ["sea salt", "table_salt"],
    ["kosher salt", "kosher_salt"],
    ["baking soda", "baking_soda"],
    ["bicarbonate of soda", "baking_soda"],
    ["sodium bicarbonate", "baking_soda"],
    ["baking powder", "baking_powder"],
    ["white rice", "white_rice"],
    ["rice", "white_rice"],
    ["long grain rice", "white_rice"],
    ["uncooked rice", "white_rice"],
    ["chopped onion", "chopped_onion"],
    ["diced onion", "chopped_onion"],
    ["grated parmesan", "grated_parmesan"],
    ["parmesan", "grated_parmesan"],
    ["parmesan cheese", "grated_parmesan"],
  ];

  it("has exactly the pre-change pair count (81 pairs)", () => {
    expect(FROZEN_ALIAS_MAP.length).toBe(81);
  });

  it.each(FROZEN_ALIAS_MAP)("%s -> %s (unchanged by this task)", (alias, expectedId) => {
    expect(findDensity(alias)?.id).toBe(expectedId);
  });
});

describe("frozen id -> gramsPerCup map — no density figure changes, no entry added or removed", () => {
  const FROZEN_DENSITY_MAP: ReadonlyArray<readonly [string, number]> = [
    ["water", 236.588236],
    ["all_purpose_flour", 125],
    ["bread_flour", 120],
    ["cake_flour", 120],
    ["whole_wheat_flour", 120],
    ["cornstarch", 128],
    ["cocoa_powder", 86],
    ["rolled_oats", 90],
    ["breadcrumbs", 108],
    ["granulated_sugar", 200],
    ["brown_sugar", 220],
    ["powdered_sugar", 120],
    ["butter", 227],
    ["vegetable_oil", 218],
    ["olive_oil", 216],
    ["milk", 244],
    ["heavy_cream", 238],
    ["sour_cream", 230],
    ["yogurt", 245],
    ["honey", 340],
    ["maple_syrup", 322],
    ["peanut_butter", 258],
    ["table_salt", 292],
    ["kosher_salt", 128],
    ["baking_soda", 220],
    ["baking_powder", 221],
    ["white_rice", 185],
    ["chopped_onion", 160],
    ["grated_parmesan", 100],
  ];

  it("DENSITY_TABLE has exactly 29 entries", () => {
    expect(DENSITY_TABLE.length).toBe(29);
  });

  it("has exactly 29 id -> gramsPerCup pairs", () => {
    expect(FROZEN_DENSITY_MAP.length).toBe(29);
  });

  it.each(FROZEN_DENSITY_MAP)("%s gramsPerCup is %d (unchanged)", (id, expectedGramsPerCup) => {
    const entry = DENSITY_TABLE.find((e) => e.id === id);

    expect(entry).toBeDefined();
    expect(entry?.gramsPerCup).toBe(expectedGramsPerCup);
  });
});

describe("the named Dutch mappings resolve to their real entries", () => {
  const NAMED_DUTCH_MAPPINGS: ReadonlyArray<readonly [string, string]> = [
    // olive oil
    ["olijfolie", "olive_oil"],
    ["olijf olie", "olive_oil"],
    ["extra vierge olijfolie", "olive_oil"],
    ["extra vergine olijfolie", "olive_oil"],
    ["traditionele olijfolie", "olive_oil"],
    // water
    ["kokend water", "water"],
    ["kokende water", "water"],
    ["verse water", "water"],
    // heavy cream
    ["slagroom", "heavy_cream"],
    ["verse slagroom", "heavy_cream"],
    // honey
    ["honing", "honey"],
    ["vloeibare honing", "honey"],
    // salt
    ["zout", "table_salt"],
    ["keukenzout", "table_salt"],
    ["fijn zout", "table_salt"],
    ["zeezout", "table_salt"],
    // flours & starches
    ["bloem", "all_purpose_flour"],
    ["tarwebloem", "all_purpose_flour"],
    ["patentbloem", "all_purpose_flour"],
    ["volkorenmeel", "whole_wheat_flour"],
    ["maizena", "cornstarch"],
    ["cacao", "cocoa_powder"],
    ["cacaopoeder", "cocoa_powder"],
    ["havermout", "rolled_oats"],
    ["paneermeel", "breadcrumbs"],
    // sugars
    ["suiker", "granulated_sugar"],
    ["kristalsuiker", "granulated_sugar"],
    ["witte suiker", "granulated_sugar"],
    ["bruine suiker", "brown_sugar"],
    ["poedersuiker", "powdered_sugar"],
    // fats & oils
    ["boter", "butter"],
    ["roomboter", "butter"],
    ["gesmolten boter", "butter"],
    ["olie", "vegetable_oil"],
    ["plantaardige olie", "vegetable_oil"],
    ["zonnebloemolie", "vegetable_oil"],
    ["slaolie", "vegetable_oil"],
    // dairy
    ["melk", "milk"],
    ["volle melk", "milk"],
    ["yoghurt", "yogurt"],
    ["griekse yoghurt", "yogurt"],
    // syrups & spreads
    ["ahornsiroop", "maple_syrup"],
    ["pindakaas", "peanut_butter"],
    // leaveners
    ["bakpoeder", "baking_powder"],
    ["zuiveringszout", "baking_soda"],
    // grains
    ["rijst", "white_rice"],
    ["witte rijst", "white_rice"],
    // onion (D-27-W5P-07)
    ["ui", "chopped_onion"],
    ["gesnipperde ui", "chopped_onion"],
    ["onion", "chopped_onion"],
    ["chopped onion", "chopped_onion"],
    // parmesan
    ["parmezaan", "grated_parmesan"],
    ["parmezaanse kaas", "grated_parmesan"],
    ["geraspte parmezaanse kaas", "grated_parmesan"],
  ];

  it.each(NAMED_DUTCH_MAPPINGS)("%s -> %s", (name, expectedId) => {
    expect(findDensity(name)?.id).toBe(expectedId);
  });

  it("normalizeIngredientName spot checks", () => {
    expect(normalizeIngredientName("kokend water")).toBe("water");
    expect(normalizeIngredientName("Verse Slagroom")).toBe("slagroom");
  });
});

describe("names that stay UNCOVERED — D-27-W5P-06 and the no-fabrication rule", () => {
  const STILL_UNCOVERED = [
    "kaas",
    "geraspte kaas",
    "feta kaas",
    "feta cheese",
    "grated cheese",
    "mozzarella",
    "aubergine",
    "basilicum",
    "champignons",
    "ham",
    "gremolata",
    "marshmallow",
    "cheesecake",
    "rode wijn",
    "red wine",
    "hearty cream",
    "other herbs",
  ];

  it.each(STILL_UNCOVERED)("%s stays null — no figure in the table", (name) => {
    expect(findDensity(name)).toBeNull();
  });

  it("no generic cheese mapping crept in", () => {
    for (const entry of DENSITY_TABLE) {
      for (const alias of entry.aliases) {
        expect(alias).not.toBe("kaas");
        expect(alias).not.toBe("geraspte kaas");
        expect(alias).not.toBe("feta");
        expect(alias).not.toBe("mozzarella");
      }
    }
  });
});

describe("the English lookup surface is unchanged where it already worked", () => {
  const STILL_NULL = ["coconut flour", "dragon fruit puree", "saffron threads", "almond flour"];

  it.each(STILL_NULL)("%s still returns null", (name) => {
    expect(findDensity(name)).toBeNull();
  });

  it("longest-match precedence is unchanged", () => {
    expect(findDensity("brown sugar")?.id).toBe("brown_sugar");
    expect(findDensity("peanut butter")?.id).toBe("peanut_butter");
    expect(findDensity("whole wheat flour")?.id).toBe("whole_wheat_flour");
  });

  it("normalizeIngredientName is unchanged for the two pinned English cases", () => {
    expect(normalizeIngredientName("Fresh Chopped Onion")).toBe("onion");
    expect(normalizeIngredientName("Whole Wheat Flour")).toBe("whole wheat flour");
  });
});
