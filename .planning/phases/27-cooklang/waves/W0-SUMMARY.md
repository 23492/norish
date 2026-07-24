# Phase 27 — W0 (Units subsystem) — SUMMARY

> Status: **CODE-COMPLETE**, green gates. Additive, un-wired, safe on `main`.
> Scope per `27-ARCHITECTURE.md` §7 (W0) + `27-DECISIONS.md` (UNITS). NO deploy, NO stack,
> NO DB, NO write-path wiring, `unit-converter.ts` NOT deleted (that is W6).

## What shipped

A deterministic, pure, standalone units-conversion module at
`packages/shared/src/units/` (exported as `@norish/shared/units`):

| File | Role |
|---|---|
| `types.ts` | `ConversionResult` = `ConversionOk \| ConversionFlagged`; `UnitDimension`, `UnitSystem`, `FlagReason`. |
| `unit-dimensions.ts` | Canonical unit ID → `convert` symbol + physical dimension; a conservative raw-unit synonym map; `resolveCanonicalUnit` / `dimensionOf`. |
| `density-table.ts` | Config-as-code USDA-distilled density table (g/mL), each row carrying its cited grams-per-cup + source. |
| `ingredient-density.ts` | Conservative, longest-match-first ingredient-name → density lookup. |
| `convert-measure.ts` | The API: `convertToUnit`, `convertToSystem`, `deriveConversion`. |
| `index.ts` | Barrel. |

Tests: `packages/shared/__tests__/units/convert-measure.test.ts` — **32 tests**.

## The `convert` dependency

- **`convert@7.0.2`**, **MIT** (confirmed via `npm view` + bundled `LICENSE`).
  TS-native, zero runtime deps, tree-shakeable, deterministic. Exactly the v7-line
  `convert` package named in `27-ARCHITECTURE.md` §3.1.
- Added to `packages/shared/package.json` (`"convert": "7.0.2"`); `pnpm-lock.yaml`
  regenerated (`--lockfile-only`). Verified at build time: `convert` accepts every
  canonical unit ID name we use and **throws on cross-dimension** (`cup`→`g`),
  which is precisely the guardrail we rely on.

## Conversion API

```ts
convertToUnit(quantity, fromUnit, toUnit, { ingredient? }): ConversionResult
convertToSystem(quantity, fromUnit, "metric"|"us", { ingredient? }): ConversionResult
deriveConversion({ ingredient?, quantity, unit }, { unit } | { system }): ConversionResult
```

- Inputs are **canonical unit IDs** (the `.cook` `%unit` per D-8); a synonym map
  also accepts common raw units (`g`, `oz`, `ml`, `cup`, `tbsp`…). The authoritative
  normalizer remains config-driven `normalizeUnit` (`@norish/shared/lib/unit-localization`).
- **Success:** `{ ok: true, quantity, unit, via: "identity"|"same-dimension"|"density", density? }`.
- **Flagged (never a number):** `{ ok: false, flagged: true, reason: "unknown-density"|"not-convertible"|"no-quantity", original: { quantity, unit } }`.
- **Same-dimension** (g↔oz, ml↔cup↔tsp, °C↔°F) → `convert`. No hand-rolled factors.
- **Volume↔weight** → density table; **`convertToSystem` stays within-dimension**
  (metric/US projection), never auto-crossing volume↔weight (that is an explicit
  `convertToUnit(..., toUnit=gram)` call).
- Count/descriptive units (piece, clove, pinch, can…) and length (no US canonical
  unit) are **system-neutral → returned unchanged**.

## Density table — source & coverage

- **Source: USDA FoodData Central** (`foodPortions.gramWeight`, public domain/CC0),
  with a few figures from the **King Arthur Baking Ingredient Weight Chart** where
  noted per row. Water is definitional (1.000 g/mL). Density stored as **g/mL**,
  derived from the cited **grams per US customary cup (236.588 mL)** — the same cup
  `convert` uses, so the table is internally consistent.
- **~29 ingredients + water:** flours (AP 125, bread 120, cake 120, whole-wheat 120,
  cornstarch 128, cocoa 86, oats 90, breadcrumbs 108), sugars (granulated 200, brown
  220, powdered 120), fats (butter 227, vegetable oil 218, olive oil 216), dairy/wet
  (milk 244, heavy cream 238, sour cream 230, yogurt 245), syrups/spreads (honey 340,
  maple 322, peanut butter 258), salt/leaveners (table salt 292, kosher 128, baking
  soda 220, baking powder 221), rice 185, chopped onion 160, grated parmesan 100
  (all grams/US-cup). Each row records its cited figure + source string → auditable.
- **Extensible:** append a `DensityEntry`; matching is longest-alias-first.

## The flag-on-unknown guarantee (no fabricated densities)

- If an ingredient is **not in the table**, or the name is **too ambiguous to match
  confidently**, a volume↔weight conversion returns **`{ ok:false, reason:"unknown-density" }`**
  — the caller preserves the original as authored. **No density is ever invented.**
- Matching is deliberately **conservative**: single-word generic aliases ("flour",
  "sugar") match only a *full* normalized name, so **"coconut flour" does NOT borrow
  all-purpose-flour density** — it flags. Multi-word aliases match as whole-word
  phrases; **longest match wins** ("brown sugar" ≠ "sugar").
- A dedicated test asserts every density-backed result's g/mL is a **member of the
  real table set** (never a synthesized number).

## Test results

- **32/32** in the new suite; **257/257** for the full `@norish/shared` package
  (0 net-new failures). Spot-checks cite their source values:
  g↔oz (100 g = 3.5274 oz), ml↔cup (236.588 ml = 1 cup), tsp↔ml (1 tsp = 4.9289 ml),
  °C↔°F (100 = 212); cup flour ≈ 125 g, cup sugar ≈ 200 g, cup water = 236.6 g,
  tbsp butter ≈ 14.2 g; unknown-density → flagged; canonical round-trips
  (g↔oz, cup↔ml) preserve value.

## Gates (all green)

- `pnpm typecheck` (full) — **17/17 EXIT 0**.
- `@norish/shared` suite — **257/257** (incl. 32 new). No net-new failures.
- `pnpm --filter @norish/shared lint` — **0 errors** (45 warnings = baseline;
  units files contribute 0).
- `pnpm --filter @norish/web build` — **EXIT 0** (module lands in a web-consumed
  package but is not yet imported).

## Notes for later waves

- **`convertToSystem` picks a single canonical target unit per (dimension, system)**
  with a small magnitude tier (mass-US: pound≥1 lb else ounce; volume-metric:
  liter≥1 L else milliliter; volume-US: cup/tbsp/tsp). The norish unit config has
  **no `kilogram` / `fl oz` / `pint` canonical IDs**, so mass-metric collapses to
  `gram` and US volume never uses fluid-ounce — fine for W0, but W2's derive path
  may want to add those canonical IDs for nicer large-quantity projections.
- **Density-coverage gap will hit the W5 backfill:** only ~29 common ingredients are
  covered, so any recipe authored in *volume* for an out-of-table ingredient
  (spices, nuts, specialty flours, produce beyond onion) will **flag rather than
  convert** its opposite-system amount. That is the intended flag-and-preserve
  behavior, but the backfill should measure the flag rate and the table likely wants
  expansion (more USDA rows) before W5 to keep the US↔metric projection useful.
- **Hoisted-linker:** `convert` was placed into the root `node_modules` for this
  sandbox; a clean `pnpm install` in CI/deploy resolves it from the regenerated
  lockfile.
