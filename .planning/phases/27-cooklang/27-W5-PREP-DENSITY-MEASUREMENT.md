# Phase 27 — W5 Prep: Density-table measurement (prerequisite state)

> Status: **READ-ONLY MEASUREMENT, 2026-07-27**. No code was changed, no table was expanded,
> and the W5 backfill was not run. This document records the prerequisite measurement state
> that `STATE.md` calls for before expanding the USDA density table for W5. Ground truth:
> live stack (6 recipes, 136 ingredient rows; single-household instance), measured against
> unmodified `packages/shared/src/units/density-table.ts` and `ingredient-density.ts`.

---

## Density table as shipped

**Source file:** `packages/shared/src/units/density-table.ts`

- **Coverage:** `DENSITY_TABLE.length === 29` (28 foods + definitional `water`)
- **Landed:** W0, commit `a4f9c2a5`
- **Lookup mechanism:** `findDensity` in `packages/shared/src/units/ingredient-density.ts`
  - Name normalized by `normalizeIngredientName`: lowercase, punctuation → spaces, English-only
    prep-word stopword list stripped
  - Single-word aliases must equal the whole normalized name
  - Multi-word aliases match as a whole-word phrase
  - Longest alias wins
  - All aliases are English/US spellings; **no Dutch aliases exist**

---

## Volume unit set

Derived from `unit-dimensions.ts` CANONICAL_UNIT_MAP dimension "volume":
- milliliter, centiliter, deciliter, liter
- teaspoon, tablespoon, cup

The DB stores already-normalized canonical IDs, so querying the canonical set is correct.

---

## Live footprint (as of 2026-07-27)

| Metric | Value |
|--------|-------|
| Total ingredient rows | 136 |
| Volume-authored rows | 45 (33.1%) |
| Distinct volume-authored names | 29 out of 83 total distinct names |
| Rows with blank unit (to-taste/descriptive) | 32 (23.5%) — correctly excluded |
| Rows with volume unit + null amount | 0 |
| Empty/junk names | 0 |
| `cook_source` populated | 0 of 6 recipes |
| `cook_review_needed` set (unset is false) | 0 of 6 recipes |

---

## Flag rate measurement

**Method:** ran unmodified `findDensity()` over all 29 distinct volume-authored ingredient names.

### Results

| Category | Count | Rate |
|----------|-------|------|
| Covered by density table | 4 | 13.8% |
| Uncovered (no match or no Dutch aliases) | 25 | 86.2% |
| **Ingredient-level flag rate** | **25/29** | **86.2%** |
| **Recipe-level flag rate** (recipes with ≥1 uncovered ingredient) | **6/6** | **100%** |

Covered names: olive oil, vegetable oil, white sugar, grated Parmesan cheese.

### Marginal payoff: clearance curve

If we prioritize recipes by smallest-uncovered-set-first, clearing one recipe at a time:

| N recipes cleared | Uncovered names remaining | Recipe-level rate |
|-------------------|---------------------------|-------------------|
| 0 | 25 | 100% |
| 2 | 23 | 83.3% |
| 6 | 19 | 66.7% |
| 10 | 15 | 50% |
| 15 | 10 | 33.3% |
| 19 | 6 | 16.7% |
| 25 | 0 | 0% |

The rate moves in 1/6 = 16.7-point steps (one recipe per step). **There is NO intermediate point below 10% or 5% — the rate jumps straight from 16.7% to 0% on the final recipe.**

Conclusion: reaching sub-10% clearance is unreachable without covering all 25 uncovered names.

**Caveat:** 23 of 25 uncovered names occur in exactly one recipe each, so occurrence-frequency ranking does NOT predict recipe clearance (i.e., expanding the table to cover high-frequency items first would not accelerate the clearance curve).

---

## KEY FINDING: Recommended W5 prep direction

**Most of the 25 "uncovered" names are foods ALREADY in the table, failing only for lack of Dutch aliases:**

- `olijfolie`, `(olijf)olie`, `extra vierge olijfolie`, `traditionele olijfolie` are all mappings to `olive_oil`
- `kokend water` fails only because `kokend` is not in the English-only prep-descriptor stopword list, so it never reduces to bare `water`
- `verse slagroom` and `vloeibare honing` are near-misses of `heavy_cream` and `honey`

### Recommendation

**The highest-ROI W5 prep is a DUTCH ALIAS PASS over the existing 29 density entries, NOT new density rows.** This supersedes the plain "expand the table" framing in `STATE.md`. Adding Dutch aliases to the existing config is a narrower scope and higher impact than sourcing new densities from the USDA table.

---

## Caveats and data quality notes

- **Sample size:** n=6 recipes is too small for stable percentages. One recipe edit moves the recipe-level rate by 16.7 points. Treat the rates as illustrative of the mechanism, not as durable values.
- **Near-duplicates:** `Italiaanse kruiden` vs `gedroogde Italiaanse kruiden` are separate ingredient rows (zero exact-duplicate names found; semantic dupes only).
- **Rows excluded:** 32/136 rows (23.5%) have a blank unit (to-taste/descriptive items), correctly excluded from volume analysis.
- **DB flags:** `cook_source` is populated on 0 of 6 recipes and `cook_review_needed` is false (unset) on all 6, so no recipe is excluded from W5 backfill scope.
- **Relationship to broader flag:** The density-specific flag measured here is one contributing signal to, not an alias for, `recipes.cook_review_needed` as defined in `27-ARCHITECTURE.md` section 5.

---

## Appendix: Full list of 25 uncovered names

1. aubergine
2. basilicum (basil)
3. champignons (mushrooms)
4. cheesecake
5. feta cheese
6. grated cheese
7. grated parmesan cheese (borderline: is in table as `grated parmesan`, but generic grating may not normalize exactly)
8. gremolata
9. ham
10. hearty cream
11. honey (near-miss: `vloeibare honing` should map to `honey`)
12. kaas (cheese)
13. kokend water (water: fails on `kokend` prep stopword)
14. marshmallow
15. mozzarella
16. olijfolie (olive oil: fails on no Dutch alias)
17. olijf olie (olive oil variant)
18. other herbs
19. red wine
20. slagroom (cream: near-miss of `heavy_cream` or `verse slagroom`)
21. sugar (not white sugar, may be different density)
22. traditionele olijfolie (traditional olive oil variant)
23. vloeibare honing (liquid honey)
24. verse slagroom (fresh whipped cream)
25. zout (salt)

---

## References

- Density table config: `/opt/norish-src/packages/shared/src/units/density-table.ts`
- Lookup algorithm: `/opt/norish-src/packages/shared/src/units/ingredient-density.ts`
- Architecture and W5 backfill scope: `/opt/norish-src/.planning/phases/27-cooklang/27-ARCHITECTURE.md` §8, §11
- Unit subsystem docs: `/opt/norish-src/.planning/phases/27-cooklang/waves/W0-SUMMARY.md`
