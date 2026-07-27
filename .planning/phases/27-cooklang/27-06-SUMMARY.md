---
phase: 27-cooklang
plan: 06
subsystem: units
tags: [convert, units, density, cooklang, i18n, dutch]

requires:
  - phase: 27-cooklang (W0-W4)
    provides: the deterministic units-conversion subsystem (`@norish/shared/units`), the
      units config (`@norish/config/units.default.json`), the density table
      (`@norish/shared/src/units/density-table.ts`), and D-27-W3-07's measurement that the
      derived US-system output was worse than the AI's own.
provides:
  - kilogram/fluid_ounce/pint as real canonical unit IDs (config entry, dimension,
    synonyms, round-trip)
  - resolveUnitsMap — a single read-time units-config resolver closing the syncUnits
    no-op trap, replacing the duplicated four-branch fallback in two readers
  - the US dry-goods volume preference in convertToSystem (mass -> US volume when a
    real density exists, one-directional, density-gated)
  - roundQuantity — 3-significant-digit presentation rounding applied at exactly one site
  - a bilingual (English + Dutch) prep-stopword list and Dutch aliases on 24 density-table
    entries, plus the chopped_onion repair (D-27-W5P-07)
affects: [27-cooklang (W5, W6)]

tech-stack:
  added: []
  patterns:
    - "read-time config merge over a stored value, never a boot-time write (D-27-W5P-05)"
    - "full-table runtime invariant + a frozen pre-change pair map as belt-and-braces
      regression proof, instead of spot-check assertions"
    - "one-directional, density-gated dimension crossing in a system-projection function"

key-files:
  created:
    - packages/config/src/units-config.ts
    - packages/config/__tests__/config/units-config.test.ts
    - packages/shared/__tests__/units/vocabulary.test.ts
    - packages/shared/__tests__/units/rounding.test.ts
    - packages/shared/__tests__/units/ingredient-density-nl.test.ts
    - .planning/phases/27-cooklang/deferred-items.md
  modified:
    - packages/config/src/units.default.json
    - packages/config/package.json
    - packages/shared-server/src/config/server-config-loader.ts
    - packages/shared-server/__tests__/config/server-config-loader.test.ts
    - packages/db/src/repositories/ingredients.ts
    - packages/shared/src/units/unit-dimensions.ts
    - packages/shared/src/units/convert-measure.ts
    - packages/shared/src/units/index.ts
    - packages/shared/__tests__/units/convert-measure.test.ts
    - packages/db/__tests__/server/db/repositories/cook-projection.test.ts
    - packages/shared/src/units/density-table.ts
    - packages/shared/src/units/ingredient-density.ts
    - packages/shared/__tests__/cooklang/serialize.test.ts

key-decisions:
  - "D-27-W5P-01: mass -> US volume crossing is one-directional and gated on a REAL density (never fabricated)"
  - "D-27-W5P-02: fluid_ounce/pint enter the vocabulary but stay OUT of the automatic US ladder"
  - "D-27-W5P-03/04: roundQuantity is 3 significant digits, applied once, and never touches via:\"identity\""
  - "D-27-W5P-05: the units-config no-op trap is closed at the READ boundary, not a boot-time write"
  - "D-27-W5P-06: generic Dutch cheese words are NOT mapped to grated_parmesan"
  - "D-27-W5P-07: chopped_onion is repaired by adding reachable single-word aliases, not by touching the stopword list"

requirements-completed: [COOK-01]

duration: ~50min
completed: 2026-07-27
---

# Phase 27 Plan 06: Wave W5-PREP (units vocabulary, rounding rule, Dutch density aliases) Summary

**Closed the D-27-W3-07 flagship regression (`2 cup flour` no longer degrades to `8.81849 ounce`) with a density-gated, one-directional US volume preference, a single `roundQuantity` presentation-rounding rule, and a bilingual Dutch alias pass over the density table — two of W5's three hard prerequisites are now discharged in code, offline, with no migration and no live-data touch.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-07-27
- **Tasks:** 4/4 completed
- **Files modified:** 17 (6 created, including 1 planning artifact; 12 modified)

## Accomplishments

- `kilogram`, `fluid_ounce` and `pint` are real canonical unit IDs end to end (config, `CANONICAL_UNIT_MAP`, `normalizeUnit`/`formatUnit`, round-trip) — before this wave all three were absent and `dimensionOf` reported `count`, freezing a US-authored `fl oz`/`pint` measure unchanged.
- `resolveUnitsMap` (new `@norish/config/units-config` module) replaces a four-branch fallback duplicated in two readers, and closes the `syncUnits` no-op trap at the READ boundary: a unit key added to `units.default.json` is now visible on an install whose `server_config.units` row predates it, with no DB write.
- `convertToSystem` now crosses a US-targeted MASS into VOLUME when the ingredient has a real density (D-27-W5P-01) — `250 g flour` returns `2 cup` (`via: "density"`), matching the AI's own output D-27-W3-07 measured as better; the crossing never fires without a density entry (`chicken breast` still returns `pound`) and never fires from metric (`1 cup flour -> metric` still returns a volume).
- `roundQuantity` gives every converted quantity 3 significant digits, applied at exactly one site inside `convertToUnit`; `via: "identity"` results are never re-rounded.
- A bilingual (English + Dutch) prep-stopword list and Dutch aliases on 24 density-table entries close the density-measurement's KEY FINDING (most Dutch misses were a stopword-list gap, not a missing USDA figure) — proven by a full-table alias-reachability invariant rather than spot checks, plus a frozen 81-pair pre-change English alias map and a frozen 29-pair density map (no figure moved, no entry added or removed).

## Task Commits

1. **Task 1: kilogram/fluid_ounce/pint canonical units + one units-config resolver** — `f93eaf65` (feat)
2. **Task 2: the converter — US dry-goods volume preference + roundQuantity** — `311eada3` (feat)
3. **Task 3: reconcile the four W0 assertions the rounding rule tightens** — `d18f02d7` (test)
4. **Task 4: the Dutch alias + prep-stopword pass** — `9d7b6b3e` (feat)

## Files Created/Modified

- `packages/config/src/units-config.ts` — `resolveUnitsMap(value): UnitsMap`, the single stored-value resolver (D-27-W5P-05).
- `packages/config/src/units.default.json` — appended `kilogram`/`fluid_ounce`/`pint` (67 units total, was 64).
- `packages/config/package.json` — `"./units-config"` export entry.
- `packages/config/__tests__/config/units-config.test.ts` — the four stored-shape cases + stored-wins-per-key + file-fills-the-gap + `normalizeUnit`/`formatUnit` collision guards.
- `packages/shared-server/src/config/server-config-loader.ts` — `getUnits` now delegates to `resolveUnitsMap`.
- `packages/shared-server/__tests__/config/server-config-loader.test.ts` — 3 tests updated to assert the merged-with-file-defaults result instead of the old stored-only result.
- `packages/db/src/repositories/ingredients.ts` — `getUnitsForNormalization` now delegates to `resolveUnitsMap`.
- `packages/shared/src/units/unit-dimensions.ts` — `kilogram`/`fluid_ounce`/`pint` in `CANONICAL_UNIT_MAP` + `UNIT_SYNONYMS`, without colliding with `ounce`'s `oz`/`bottle`'s `fl`.
- `packages/shared/src/units/convert-measure.ts` — `roundQuantity`, the US dry-goods volume preference in `convertToSystem`, `SYSTEM_TARGETS.mass.metric` gains `kilogram`.
- `packages/shared/src/units/index.ts` — re-exports `roundQuantity`.
- `packages/shared/__tests__/units/vocabulary.test.ts` (new) — the three IDs, dimensions, round-trips, the un-freezing proof, the dry-cup non-degradation cases.
- `packages/shared/__tests__/units/rounding.test.ts` (new) — `roundQuantity` boundaries, identity non-rounding, single-application proof.
- `packages/shared/__tests__/units/convert-measure.test.ts` — 5 assertions tightened from tolerance to exact value/relative-error bound; 1 new test pinning the one-directional crossing rule.
- `packages/db/__tests__/server/db/repositories/cook-projection.test.ts` — the one row the crossing changes (flour: `ounce` → `1.6 cup`).
- `packages/shared/src/units/density-table.ts` — Dutch aliases on 24 entries, `onion`/`ui` on `chopped_onion`, `bicarbonate soda` on `baking_soda`.
- `packages/shared/src/units/ingredient-density.ts` — 36 Dutch prep/state descriptors appended to `PREP_DESCRIPTORS`.
- `packages/shared/__tests__/units/ingredient-density-nl.test.ts` (new) — the full-table invariant, frozen maps, named Dutch mappings, still-uncovered names, English regression.
- `packages/shared/__tests__/cooklang/serialize.test.ts` — one fixture's unit swapped from `fl oz` (now a recognized canonical alternate) to an unrecognized custom unit, preserving the test's original multi-word-escaping intent.
- `.planning/phases/27-cooklang/deferred-items.md` (new) — the pre-existing, unrelated `db-schema` circular-dependency finding.

## Decisions Made

- **D-27-W5P-01** — the dry-cup fix is a selection rule (US + mass source + a real density ⇒ target dimension becomes volume), not a new unit; metric never crosses, no density never crosses.
- **D-27-W5P-02** — `fluid_ounce`/`pint` are real canonical IDs but stay out of the automatic US ladder; D-27-W3-07's measured AI output never produced either. Reversible in 2 lines (add to `SYSTEM_TARGETS.volume.us` + a `MIN_MAGNITUDE` entry) — flagged here as the director decision point.
- **D-27-W5P-03/04** — `roundQuantity` is 3 significant digits (never fewer than 0 decimals, never discards an integer digit ≥ 1000), applied at exactly one site, and never applied to an unconverted (`identity`) measure.
- **D-27-W5P-05** — the units-config merge happens at READ time (`resolveUnitsMap`), never a boot-time write to `server_config`; `packages/api/src/startup/seed-config.ts` is untouched (`git diff --stat` on it is empty, verified).
- **D-27-W5P-06** — generic Dutch `kaas`/feta/mozzarella/generic-grated-cheese are deliberately NOT mapped to `grated_parmesan` (only figure we have is for hard grated cheese specifically). Flagged for the director: closing these needs 3 real USDA figures, a W5 table-expansion item, not a rename.
- **D-27-W5P-07** — `chopped_onion` was DEAD on the pre-change tree (both aliases begin with a stripped prep word); repaired by adding the reachable single-word `onion`/`ui` aliases, never by touching the stopword list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The invariant caught a SECOND pre-existing dead alias: `"bicarbonate of soda"`**
- **Found during:** Task 4, writing the full-table alias-reachability invariant.
- **Issue:** `"of"` was already an English `PREP_DESCRIPTOR` from a much earlier wave (predates this plan, unrelated to the Dutch additions), so `"bicarbonate of soda"` normalizes to `"bicarbonate soda"` and can never match the literal multi-word alias `"bicarbonate of soda"`. The plan predicted only `chopped_onion` as a pre-change failure; this is a genuinely new finding.
- **Fix:** Added the reachable reduced-form alias `"bicarbonate soda"` to the `baking_soda` entry — same repair pattern as D-27-W5P-07 (add a reachable alias, don't touch the long-standing stopword list).
- **Files modified:** `packages/shared/src/units/density-table.ts`
- **Verification:** The full-table invariant test (`ingredient-density-nl.test.ts`) is green; before the fix it failed with `"bicarbonate of soda" -> null (expected baking_soda)`.
- **Committed in:** `9d7b6b3e` (Task 4 commit)

**2. [Rule 1 - Bug] Task 1's `getUnits`/`getUnitsForNormalization` tests asserted the OLD (no-op-trap) behavior**
- **Found during:** Task 1, running `pnpm --filter @norish/shared-server test` after wiring `resolveUnitsMap` into `getUnits`.
- **Issue:** 3 existing tests in `server-config-loader.test.ts` asserted that a stored map with exactly one key (`cup`) returned ONLY that key — the exact no-op-trap behavior D-27-W5P-05 exists to fix. With the correct merge behavior, those 3 tests failed as expected.
- **Fix:** Updated the 3 tests to assert the merged-with-file-defaults result (`{ ...defaultUnits, cup: storedCup }`), documenting the new behavior inline.
- **Files modified:** `packages/shared-server/__tests__/config/server-config-loader.test.ts`
- **Verification:** `pnpm --filter @norish/shared-server test` — 556 passed, 0 failed (matches the plan's pinned baseline).
- **Committed in:** `f93eaf65` (Task 1 commit)

**3. [Rule 1 - Bug] `fl oz` now normalizes in `serialize.test.ts`, changing an unrelated fixture's output**
- **Found during:** Task 2, running the full `@norish/shared` test suite for the first time after Task 1's `units.default.json` change.
- **Issue:** `packages/shared/src/cooklang/serialize.ts`'s `canonicalUnit` runs every unit through `normalizeUnit(raw, unitsConfig)`, and the test's fixture uses the REAL `units.default.json`. Before this wave, `fl oz` matched no unit's alternates and passed through unchanged — exactly the vocabulary gap this wave closes (D-27-W5P-02). After Task 1, `fl oz` correctly normalizes to `fluid_ounce`, so a test asserting `@milk{8%fl oz}` stays literal broke — the test's stated purpose (multi-word unit escaping) no longer held for that example.
- **Fix:** Swapped the fixture's unit to an unrecognized custom multi-word unit (`"generous glug"`) that still exercises the escaping behavior the test was written for, without relying on a now-recognized unit.
- **Files modified:** `packages/shared/__tests__/cooklang/serialize.test.ts`
- **Verification:** `pnpm --filter @norish/shared test cooklang/serialize` — 42 passed, 0 failed; full `@norish/shared` suite — 371 passed (after Task 2), 564 passed (after Task 4).
- **Committed in:** `311eada3` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 — bug fixes, all tightenings, none a relaxation)
**Impact on plan:** All three are direct, foreseeable (and in two cases explicitly plan-predicted-in-kind) consequences of the wave's own behavior changes. No scope creep — no file outside the plan's `files_modified` list was touched except the two test-fixture reconciliations, both logged here.

## Issues Encountered

- `pnpm deps:cycles` reports one circular dependency (`packages/db-schema/src/schema/auth.ts -> packages/db-schema/src/schema/households.ts`) on the pre-change tree, unaffected by this plan. Verified identical before this plan's first edit and after its last; `packages/db-schema/` never appears in this plan's diff. Logged to `.planning/phases/27-cooklang/deferred-items.md` per the SCOPE BOUNDARY rather than fixed.

## Gate Results (pinned baselines from the plan, all verified in one consistent run)

| Gate | Command | Result |
|---|---|---|
| config test | `pnpm --filter @norish/config test` | **755 passed, 0 failed** (745 predicted baseline + 10 `units-config.test.ts` cases — reconciled here per the plan's own escape hatch) |
| shared-server test | `pnpm --filter @norish/shared-server test` | **556 passed, 0 failed** |
| real tsc (shared-server) | `pnpm exec tsc --noEmit` in `packages/shared-server` | clean, 0 errors |
| shared test | `pnpm --filter @norish/shared test` | **564 passed, 0 failed** (345 baseline + 219 new: 25 vocabulary/rounding + 193 ingredient-density-nl + 1 new convert-measure test) |
| shared units (Task 3 gate) | `pnpm --filter @norish/shared test units/convert-measure` | **33 passed** (32 baseline + 1 new) |
| db test | `pnpm --filter @norish/db test` | **183 passed, 0 failed** (Postgres available, ran for real) |
| typecheck | `pnpm typecheck` | **17/17 EXIT 0** |
| lint (config/shared/db/shared-server) | `pnpm --filter @norish/{pkg} lint` | **0 errors** in each; warnings at each package's pre-existing baseline (config 1, shared 45, db 62, shared-server 57 — verified identical against the pre-task file content, none newly introduced) |
| deps:cycles | `pnpm deps:cycles` | 1 pre-existing, unrelated cycle (`db-schema`); not introduced by this plan |
| lockfile | `git diff pnpm-lock.yaml` | EMPTY |
| seed-config | `git diff --stat packages/api/src/startup/seed-config.ts` | EMPTY |
| migrations | `git diff --stat packages/db/src/migrations/` + journal check | EMPTY diff; `_journal.json` still 42 entries, last tag `0041_add_cook_source` |

**Flagship acceptance criteria, each asserted with `toBe`, not a range:**
- `convertToSystem(250, "gram", "us", { ingredient: "flour" })` → `{ unit: "cup", quantity: 2, via: "density" }`.
- `convertToSystem(8, "fl oz", "metric")` → `{ unit: "milliliter", quantity: 237 }` (was `{ unit: "fl oz", quantity: 8, via: "identity" }` before this wave).
- `convertToSystem(500, "gram", "us", { ingredient: "chicken breast" })` → `{ unit: "pound" }` (the no-density gate holds).
- `Object.is(convertToUnit(2, "cup", "fluid_ounce").quantity, 16)` — `true`.
- `grep -c "roundQuantity(" packages/shared/src/units/convert-measure.ts` → `3` (the definition + 2 call sites: same-dimension, the shared density branch).
- The full-table alias-reachability invariant is present, non-vacuous (recorded pre-change failures: `chopped_onion`'s two aliases AND, newly discovered, `"bicarbonate of soda"`), and green after the repairs.
- `grep -n "kaas" packages/shared/src/units/density-table.ts` → only the `pindakaas` and `parmezaanse kaas` lines.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **W5 (the live-data backfill, migration `0042`) remains PAUSED for Kiran's explicit sign-off.** This plan does not start it, plan it, or touch any part of it (no `0042`, no backfill runner, no `cook_confidence`/`cook_review_needed` read or write, no review queue, no repair tool, no single-system extraction change, no prompt change — all verified absent from the diff).
- **Two of W5's three hard prerequisites are now discharged**: the unit vocabulary (`kilogram`/`fluid_ounce`/`pint`) and the rounding rule. The density-table flag-rate measurement was already done in the prior session (`27-W5-PREP-DENSITY-MEASUREMENT.md`).
- **Open director decision points carried into W5**: (a) D-27-W5P-02 — whether to add `fluid_ounce`/`pint` to the automatic US ladder before W5 (2-line change, currently deliberately not done); (b) D-27-W5P-06 — 14 of the 25 measured Dutch names stay uncovered; sourcing feta/mozzarella/generic-grated-cheese USDA figures is a W5 table-expansion item.
- **Only the sign-off itself remains before W5 can start.**
