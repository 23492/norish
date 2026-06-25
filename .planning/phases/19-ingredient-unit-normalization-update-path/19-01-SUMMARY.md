---
phase: 19-ingredient-unit-normalization-update-path
plan: 19-01
subsystem: db
status: complete
requirements: [UNIT-NORM-01]
commits: [bee88d06]
cross_ai: true
worker: antigravity
---

# Phase 19 Plan 19-01 SUMMARY: normalize locale-specific ingredient units on the recipe UPDATE path (parity with CREATE)

## Outcome: COMPLETE — verified green in this LXC (Docker testcontainers via `sg docker`). No human-verify gate: this is a pure db-layer correctness fix with no UI/auth/deploy surface.

The recipe UPDATE path (`syncRecipeIngredientsTx` in `packages/db/src/repositories/recipes.ts`) now normalizes locale-specific unit terms to canonical IDs exactly like the CREATE path, closing the 3 `updateRecipeWithRefs` failures in `ingredient-unit-normalization.test.ts` that Phase 18's SUMMARY logged as pre-existing/out-of-scope.

## What changed (commit bee88d06 — cross-AI worker, native-reviewed)

Byte-for-byte the previously-reverted commit `17cb5659` (range-diff vs `bee88d06`: only the commit message differs; the code hunks are identical):
- `packages/db/src/repositories/ingredients.ts`: `getUnitsForNormalization()` is now `export`ed (so the update path reuses the SAME config-loading helper the create path uses).
- `packages/db/src/repositories/recipes.ts`: import `normalizeUnit` from `@norish/shared/lib/unit-localization` + `getUnitsForNormalization` from `./ingredients`; fetch `const units = await getUnitsForNormalization();` ONCE before the `syncRecipeIngredientsTx` loop; change the row write `unit: ingredient.unit ?? null` → `unit: normalizeUnit(ingredient.unit ?? "", units)`.

Scope held exactly: `recipes.ts:963` (the "saved copy" insert DTO builder) was correctly LEFT verbatim — that array is handed to `createRecipeWithRefs` → `attachIngredientsToRecipeByInputTx`, which normalizes downstream, so it is not a second un-normalized path. No schema/migration, no create-path/reader/trpc/test changes, no new dependency. No security surface (canonicalizes a free-text unit string on the recipe being edited; crosses no household/cookbook boundary).

## Why a new phase instead of un-reverting

`17cb5659` was a direct director hand-edit and was reset away because this fork forbids hand-editing (delegate-via-gsd hard constraint). Phase 19 re-did the SAME change through the sanctioned flow: director-authored PLAN → cross-AI Antigravity/Gemini worker made + committed the edit → native Opus supervisor independently reviewed (worker self-report NOT trusted). This is the fork's FIRST real cross-AI-delegated plan execution (prior phases predate the worker; the only earlier use was a smoke commit that was reset).

## Verification (director-owned, run in this LXC — Docker reached via `sg docker`)

- **Diff review:** `git range-diff 17cb5659~1..17cb5659 bee88d06~1..bee88d06` → code identical to the canonical fix; `git diff --stat` = exactly the 2 expected files (11 insertions, 3 deletions).
- **Static:** `export async function getUnitsForNormalization` present; `normalizeUnit(ingredient.unit ?? "", units)` at recipes.ts:1293; exactly ONE `unit: ingredient.unit ?? null` left (the untouched line-968/963 saved-copy path); `recipes.ts:963` region untouched.
- **typecheck:** `tsc -p packages/db/tsconfig.json --noEmit` EXIT 0.
- **Tests:** `sg docker -c 'pnpm --filter @norish/db exec vitest run __tests__/server/db/repositories/ingredient-unit-normalization.test.ts'` → **8/8 PASS** (3 `updateRecipeWithRefs`: handvol→handful, scheut→splash via ingredientName, the 3-ingredient gr/scheut/handvol case; + 5 `createRecipeWithRefs` unregressed).
- **Adversarial:** reverting ONLY the `unit:` line to `?? null` → exactly the 3 `updateRecipeWithRefs` tests go RED (`expected 'handvol' to be 'handful'`, etc.), 5 create tests stay green; restored via `git checkout` + `cp -a` twin re-sync → 8/8 green again. Weakening never committed.
- **lint:** `pnpm --filter @norish/db lint` → 0 errors (2 PRE-EXISTING unrelated warnings: recipes.ts:102 `nonEmpty` unused, tags.ts:166 padding — neither on the changed lines).
- Did NOT run `pnpm docker:build`; did NOT touch live / `/opt/norish/`.

## Mechanics / gotchas

- Injected-workspace hardlink farm intact: `cp -a packages/db/src/. node_modules/@norish/db/src/` reported "same file" for every path → the worker's edits were already live in the `@norish/db` twin, so vitest resolved the new code without a sync. After the adversarial `git checkout` (which DOES break the hardlink), a targeted `cp -a` re-synced the twin.
- The Antigravity `--print` worker produced a malformed stdout SUMMARY ("No tools called. Waiting for task completion.") but DID make the correct commit — consistent with the known pty/stdout quirk. Per CLAUDE.md the worker's self-report is never trusted; acceptance rested entirely on the independent review above.

## Follow-ups / notes

- Phase 18's SUMMARY listed TWO pre-existing db/shared-server failures; the `archive-import-overwrite` one was already fixed earlier on this branch (commits cd2bc2bd + 7f889408, householdId threading). With Phase 19, the `ingredient-unit-normalization` failure is closed — the only remaining red on this box is environmental (Docker testcontainers requiring `sg docker`), not code.
