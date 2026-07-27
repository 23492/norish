---
phase: 27-cooklang
plan: 07
subsystem: database
tags: [cooklang, postgres, drizzle, migration, backfill, recipes, shopping-list]

# Dependency graph
requires:
  - phase: 27-cooklang (27-01..27-06)
    provides: the serializer (`@norish/shared/cooklang`), `buildCookPayload`, `deriveProjectionTx`, the token renderer (W4), and W5-PREP's unit vocabulary + rounding rule
provides:
  - "applyCookBackfill: the transactional DB write (cook_source/cook_confidence/cook_review_needed) with the grocery-link guard"
  - "backfillCookSource(): the deterministic boot-time seeder, confidence gate and runner"
  - "migration 0042 (journal-only, forward-only) + checks/0042-postcheck.sql"
  - "boot wiring in apps/web/server/index.ts"
affects: [27-07 Task 4 (the live run), Phase 27 W6 (the NOT NULL contract)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Snapshot-before / derive / recheck-after / throw-and-rollback guard for a natural-key UPSERT that also runs a DELETE (D-27-W5-06)"
    - "Sticky boolean flag write as a SQL OR against the column's current value, never a plain assignment (D-27-W5-05)"
    - "Deterministic legacy-to-structured seeder reusing the serializer's own word-boundary matcher (hasNameAnchor) instead of a second one"

key-files:
  created:
    - packages/db/src/repositories/cook-backfill.ts
    - packages/db/__tests__/server/db/repositories/cook-backfill.test.ts
    - packages/api/src/startup/backfill-cook-source.ts
    - packages/api/__tests__/startup/backfill-cook-source.test.ts
    - packages/db/src/migrations/0042_backfill_cook_source.sql
    - packages/db/src/migrations/checks/0042-postcheck.sql
    - packages/db/__tests__/server/db/migrations/0042-backfill-cook-source.test.ts
  modified:
    - packages/db/src/repositories/index.ts
    - packages/shared/src/cooklang/serialize.ts
    - packages/shared/src/cooklang/index.ts
    - packages/db/src/migrations/meta/_journal.json
    - apps/web/server/index.ts

key-decisions:
  - "Tasks 1-3 only were executed in this run. Task 4 (the live deploy that applies 0042 and runs backfillCookSource() against live) is a checkpoint:human-verify task deliberately left unexecuted, owned by a separate deploy agent per the director's instructions. Nothing here touched the live stack or live DB."
  - "D-27-W5-07 evidence recorded: the D-27-W3-07 cook-payload.test.ts measurement now reports 15 of 35 ingredient unit differences (was 18/35 at W3). Still non-zero on every one of the five fixtures, so dual-system extraction stays KEPT — the switch decision is explicitly NOT reopened by this plan."
  - "A stale node_modules/@norish/config/package.json (missing the ./units-config export subpath a prior plan added to the source) was re-synced from packages/config/package.json to unblock the real tsc --noEmit gate in packages/api. This is an environment fix only — not a code change, not committed, no source file touched."

requirements-completed: []

# Metrics
duration: ~40min (Tasks 1-3 only)
completed: 2026-07-27
---

# Phase 27 Plan 07: Cooklang W5 live-data backfill — Tasks 1-3 Summary

**The DB write half (grocery-link guard + sticky review flag), the deterministic legacy-recipe seeder + confidence gate, and migration `0042` (journal-only) + boot wiring — all code-complete on `main`; Task 4 (the live run) deliberately NOT executed.**

## Performance

- **Tasks completed:** 3 of 4 (Task 4 — the live deploy — explicitly out of scope for this executor)
- **Duration:** ~40 min
- **Completed:** 2026-07-27
- **Files created:** 7
- **Files modified:** 5

## Accomplishments

- **`applyCookBackfill`** (`packages/db/src/repositories/cook-backfill.ts`) writes a recipe's `cook_source`/`cook_confidence`/`cook_review_needed` in the SAME transaction as `deriveProjectionTx`'s re-derive. Before deriving, it snapshots every `recipe_ingredients.id` a `groceries` row points at for that recipe; after deriving, it re-checks every one of those ids survived. If any is gone — meaning the retirement DELETE took a row a shopping-list link pointed at, exactly the hole the plan-checker flagged as real — it throws `GroceryLinkWouldBreakError` and the whole transaction rolls back: no `cook_source`, nothing changed, the grocery FK stays non-NULL and unchanged. `cook_review_needed` is written as `cookReviewNeeded OR $flag` in SQL, never a plain assignment, so a `true` `0041`'s lossy-merge branch already set can never be silently cleared. The write never bumps `updated_at` or `version`.
- **`backfillCookSource()`** (`packages/api/src/startup/backfill-cook-source.ts`) is the boot-time runner. `buildStructuredRecipeFromLegacy` turns a legacy recipe's own NATIVE-system `steps` + `recipe_ingredients` into a `StructuredRecipe`: ingredients are assigned longest-name-first so `"brown sugar"` claims its anchor before `"sugar"` does, headings (`#`-prefixed steps) never receive refs, and an ingredient with no textual anchor is appended to the first non-heading step rather than dropped. `hasNameAnchor` is a new one-line additive export from the serializer (`findNameSpan(text, name) !== null`) so the seeder reuses the SAME word-boundary matcher `serializeStepLine` uses internally — a second implementation would drift and silently move a token to the wrong step. `cookConfidenceFromLinks` scores `inline / total` (empty → `1`), rounded to 3 decimals; `COOK_REVIEW_CONFIDENCE_THRESHOLD = 0.8` (strict `<`) is the named constant D-27-W5-03 decided. The runner calls no AI model, never throws (a per-recipe failure is caught and counted as `refused`/`failed`), and every log line carries ids/counts/reasons only — never a recipe name, an ingredient name, or step prose.
- **Migration `0042`** (`packages/db/src/migrations/0042_backfill_cook_source.sql`) carries ONLY the journal entry (idx 42, 43 total) and a `DO $$` precondition block that RAISEs if `0041`'s natural-key unique index is missing. No DML. The mutation itself runs as `backfillCookSource()` at boot — a SQL re-implementation of `.cook` minting would bypass the T-27-01 escaping fix. `checks/0042-postcheck.sql` is the read-only PRE/POST pair Task 4's deploy agent will run against live: recipe outcome counts, grocery-link survival (with the exact anti-join needed to prove no link was lost), per-`(recipe_id, system_used)` row counts for both `recipe_ingredients` and `steps`, and the migration count itself.
- **Boot wiring**: `backfillCookSource()` is called in `apps/web/server/index.ts` immediately after `migrateGalleryImages()` and before `initializeVideoProcessing()`, matching the plan's required ordering (after `runMigrations()` + `seedServerConfig()` + `migrateGalleryImages()`, before `startWorkers()`).

## Task Commits

1. **Task 1: The DB write half — transactional cook write, grocery-link guard, and its real-Postgres proofs** - `0d770c65` (feat)
2. **Task 2: The deterministic seeder, the confidence gate, and the runner** - `0af791f8` (feat)
3. **Task 3: Migration `0042`, the read-only postcheck, and the boot wiring** - `e56bad7f` (feat)

**Task 4 (the live run) was NOT executed** — it is a `checkpoint:human-verify` gated task owned by a separate deploy agent.

## Files Created/Modified

- `packages/db/src/repositories/cook-backfill.ts` - `applyCookBackfill`, `GroceryLinkWouldBreakError`, `listRecipeIdsWithoutCookSource`, `CookBackfillWrite`
- `packages/db/src/repositories/index.ts` - barrel export for the above
- `packages/db/__tests__/server/db/repositories/cook-backfill.test.ts` - 10 real-Postgres tests (FK survival, step-id survival, idempotency, sticky flag, guard rollback, isolation under both policies)
- `packages/shared/src/cooklang/serialize.ts` - additive `hasNameAnchor` export
- `packages/shared/src/cooklang/index.ts` - re-export
- `packages/api/src/startup/backfill-cook-source.ts` - `backfillCookSource`, `buildStructuredRecipeFromLegacy`, `cookConfidenceFromLinks`, `COOK_REVIEW_CONFIDENCE_THRESHOLD`
- `packages/api/__tests__/startup/backfill-cook-source.test.ts` - 22 tests incl. the escaping proof against the real serializer + real WASM parser
- `packages/db/src/migrations/0042_backfill_cook_source.sql` - the forward-only, journal-only precondition migration
- `packages/db/src/migrations/meta/_journal.json` - 43 entries, last tag `0042_backfill_cook_source`
- `packages/db/src/migrations/checks/0042-postcheck.sql` - read-only PRE/POST pair for the live run
- `packages/db/__tests__/server/db/migrations/0042-backfill-cook-source.test.ts` - 5 tests (precondition raises/passes, journal shape, no snapshot file, no DML)
- `apps/web/server/index.ts` - boot wiring: `backfillCookSource()` after `migrateGalleryImages()`, before `initializeVideoProcessing()`

## Decisions Made

- **D-27-W5-07 evidence recorded, not re-decided.** Re-ran `pnpm --filter @norish/api test cook-payload` (Task 2, action (d) of the plan): the D-27-W3-07 measurement now reports **15 of 35** ingredient unit differences across the five fixtures (pancakes 3/5, bolognese 3/9, guacamole 1/6, cookies 3/8, curry 5/7) — down from 18/35 at W3, reflecting W5-PREP's unit-vocabulary and rounding-rule work, but still non-zero on every fixture. Per the plan's explicit instruction, this evidence is recorded but the dual-vs-single-system extraction decision is **not** reopened here — that remains the director's call, out of this plan's scope.
- **Environment fix, not a deviation, not committed:** `node_modules/@norish/config/package.json` was missing the `./units-config` export subpath that an earlier plan (`27-06`, W5-PREP) added to `packages/config/package.json` — a hardlink-farm-adjacent staleness in a file that is not itself under `src/` and so is not covered by the `cp -a .../src/. .../src/` re-sync convention. This blocked the real `pnpm exec tsc --noEmit` gate inside `packages/api` (confirmed reproducible before my Task 2 changes by temporarily removing the new file and re-running — the error persisted). Re-synced the `package.json` from source to `node_modules`; this is local environment state only, not a source-tree change, and was not committed.

## Deviations from Plan

None beyond the environment fix noted above (which touches no tracked file). Both Task 1's and Task 2's isolation/adversarial tests found and closed one real coverage gap during the required adversarial revert-check process itself (see below) — not a deviation from the plan's instructions, but worth recording since it changed the shape of the isolation test.

### Auto-fixed Issues

**1. [Rule 1 - Bug in the test, found via the mandated adversarial weakening] Task 1's isolation test did not originally snapshot the neighbour recipe's own `recipes` row**
- **Found during:** Task 1, running the W5-W3 adversarial weakening (drop `eq(recipes.id, recipeId)` from `applyCookBackfill`'s final UPDATE)
- **Issue:** The isolation test snapshotted cookbook B's `recipe_ingredients`, `steps` and `groceries` rows, but not B's own `recipes` row. With `eq(recipes.id, recipeId)` removed, `applyCookBackfill` would write `cook_source`/`cook_confidence`/`cook_review_needed` onto EVERY recipe in the database, including cookbook B's — but the existing snapshot could not see that, so the weakening did NOT turn the isolation suite red as required by the plan's adversarial revert-check.
- **Fix:** Extended `snapshotOfB()` to also select cookbook B's own `recipes` row and assert `toEqual` across before/after, including `cookSource`/`cookConfidence`/`cookReviewNeeded`.
- **Files modified:** `packages/db/__tests__/server/db/repositories/cook-backfill.test.ts`
- **Verification:** Re-ran the weakening with the extended snapshot — both the `household` and `everyone` isolation cases now correctly turn RED (diff showed B's `cookSource`/`cookConfidence` populated by A's write); reverted the weakening byte-identical (`md5sum` match) and the suite went green again.
- **Committed in:** `0d770c65` (part of Task 1's commit — the fix landed in the same test file before the task was committed, since the adversarial check is required before a task can be considered done)

---

**Total deviations:** 1 (test-coverage gap found and closed during the plan's own mandated adversarial revert-check process; no source-code deviation)
**Impact on plan:** None on scope. The fix strengthens exactly the isolation guarantee (T-27-W5-04 in the threat register) the plan requires proven, and it was caught before any task was committed.

## Issues Encountered

- **`pnpm exec tsc --noEmit` inside `packages/api` initially failed** with `Cannot find module '@norish/config/units-config'`, traced (via `--traceResolution`) to a stale `node_modules/@norish/config/package.json` missing an export subpath present in `packages/config/package.json` since an earlier plan. Confirmed pre-existing (reproduced with my new files temporarily removed) and unrelated to this plan's diff. Resolved by re-syncing the file from source (see Decisions Made above); not a tracked change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Task 4 (the live run) is ready to execute.** All three prerequisite tasks are code-complete, tested, and committed on `main`. `checks/0042-postcheck.sql` has the exact PRE/POST queries the deploy agent needs. The migration is forward-only and carries no DML; the mutation is entirely `backfillCookSource()`, already proven never to throw and never to touch a household it wasn't given.
- **Blocker for Task 4:** none from this plan's side — it is gated on the director dispatching the separate deploy agent per the plan's `checkpoint:human-verify` protocol (verified-restorable `pg_dump` first, then `docker:build`, deploy, PRE/POST diff, and the second-restart idempotence check).
- **W6 (the NOT NULL contract)** remains unscoped beyond `27-ARCHITECTURE.md` §7 and is unaffected by this plan.

---
*Phase: 27-cooklang*
*Plan: 07 (Tasks 1-3 of 4 — Task 4 pending, owned by a separate deploy agent)*
*Completed: 2026-07-27*
