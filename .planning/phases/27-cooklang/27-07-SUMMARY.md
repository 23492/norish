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
  - "POST-VERIFICATION FIX PASS (2026-07-27, after independent verification found 3 blockers — see 27-07-VERIFICATION.md). All three closed: G1 (checks/0042-postcheck.sql selected the wrong grocery-link column), G2 (no guard against silent step-row / step_images loss), G3 (backfillCookSource could still throw and cost the boot). Task 4 remains unexecuted; live remains untouched."
  - "ACCEPTED, NOT AN OVERSIGHT (Kiran, 2026-07-27): the verifier also flagged that the backfill appends unanchored ingredient names into stored steps.step (\"Mix the flour.\" -> \"Mix the flour. olijfolie zout\") and that ~40% of opposite-system rows get amounts rewritten by deriveConversion's flag-and-preserve. Kiran was asked and explicitly chose to ACCEPT both as designed (Architecture §8, D-27-W5-07). This fix pass does NOT change either behavior and does NOT add a guard against it — it is recorded here so it is not mistaken for an oversight in a future wave."

requirements-completed: []

# Metrics
duration: ~40min (Tasks 1-3 only) + ~55min (post-verification fix pass)
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

## Post-Verification Fix Pass (2026-07-27)

An independent verifier (`.planning/phases/27-cooklang/27-07-VERIFICATION.md`, goal-backward,
FORCE stance) reviewed Tasks 1-3 before Task 4 (the live run) could proceed, and found **3
BLOCKER gaps** out of 9 must-have truths. All three are closed by this fix pass. Task 4 was
**NOT executed** in this pass either — no docker build, no deploy, no live stack or live DB
access; that remains a separate deploy agent's job.

### G1 — `checks/0042-postcheck.sql` measured the wrong column

**Found:** the PRE and POST sections selected `SELECT "id" AS recipe_ingredient_id_at_risk FROM
"groceries"`, which returns `groceries.id` — a different uuid space from
`recipe_ingredients.id`, the column the POST anti-join actually needs. Pasting the PRE list into
the POST anti-join therefore returned every id as "missing" regardless of whether a shopping-list
link actually broke: the live run's primary safety instrument proved nothing.

**Fix:** both `SELECT` statements now select `"recipe_ingredient_id" AS
recipe_ingredient_id_at_risk` (already filtered `WHERE "recipe_ingredient_id" IS NOT NULL`, so no
extra NULL guard was needed). Marker comments (`[0042-postcheck:pre-ids]` /
`[0042-postcheck:post-ids]` / `[0042-postcheck:post-antijoin]`) were added so a future edit
cannot silently drift back.

**Proof:** `packages/db/__tests__/server/db/migrations/0042-backfill-cook-source.test.ts` gained
two tests: one reads the `.sql` file by regex and asserts both `SELECT` statements use
`recipe_ingredient_id` (confirmed RED against the original file, then fixed); the other
constructs the real orphan case against Postgres — a `groceries` row pointing at a real
`recipe_ingredients` row, that row then deleted — and shows the corrected anti-join returns
exactly that row (`{ id: <the deleted row's id> }`, 1 row).

**Commit:** `ab996d47` (fix)

### G2 — no guard against silent step-row / `step_images` loss

**Found:** the grocery-link guard was real and adversarially proven, but there was no equivalent
guard for `steps`. `syncProjectedStepsTx` matches existing `steps` rows POSITIONALLY and
tail-trims any surplus, and `step_images.step_id` is `ON DELETE CASCADE`. The verifier drove the
REAL seeder -> serializer -> WASM parser -> `computeCookProjection` chain and found three
realistic legacy step shapes that collapse the derived step count below the source count: a
trailing `#` heading with no body (the section has no step content, so the parser never emits a
token entry for it), two consecutive headings (they collapse into ONE section — the first
heading's text is lost, not just its row), and a whitespace-only step (trims to empty, folded away
by the parser). Each of these commits silently inside a transaction that otherwise succeeds.

**Fix:** `applyCookBackfill` (`packages/db/src/repositories/cook-backfill.ts`) gained a second
guard, in the exact same snapshot-before / derive / recheck-after / throw-and-rollback shape as
the grocery-link guard: snapshot every native `steps.id` for the recipe BEFORE deriving, re-check
after, and throw the new `StepWouldBeLostError` if any is gone — rolling the WHOLE transaction
back (so `step_images` attached to a would-be-lost step survive too, by rollback, not by a
separate check). The guard lives on the backfill path only; `syncProjectedStepsTx` itself is
untouched, since a genuine user-authored step deletion through the normal recipe-edit path must
still work. `backfillCookSource` catches `StepWouldBeLostError` the same way it already catches
`GroceryLinkWouldBreakError`: counted `refused`, logged with the new reason
`"step-would-be-lost"` (ids/counts only, never step prose — T-27-05).

**Proof, two layers:**
- `packages/db/__tests__/server/db/repositories/cook-backfill.test.ts` gained a
  `describe("the step-loss guard (G2 fix)")` block with one test per degenerate shape (trailing
  heading, consecutive headings, whitespace-only step). Each seeds 3 native `steps` rows (with a
  `step_images` row on the one the positional tail-trim would actually delete) and hand-builds the
  `cookTokens` shape the real chain produces for that input, asserting `rejects.toThrow(
  StepWouldBeLostError)`, `cookSource` stays `null`, every `steps.id` is unchanged, and the
  `step_images` row still exists.
- `packages/api/__tests__/startup/backfill-cook-source.test.ts` gained a
  `describe("G2: the real chain collapses these three legacy step shapes")` block that drives the
  REAL chain (`buildStructuredRecipeFromLegacy` -> `buildCookPayload` -> `computeCookProjection`,
  the last imported from `@norish/db` since `@norish/api` already depends on it) for the same
  three inputs and asserts the derived step count is strictly less than the native step count —
  proving these are genuine defect-triggering inputs, not just constructed db-level fixtures.

**Adversarial revert-check (all four, including the new one, confirmed RED and reverted
byte-identical, nothing committed):**
- **W5-W4 (new)** — deleted the `StepWouldBeLostError` throw: all 3 new step-loss tests failed
  (`promise resolved ... instead of rejecting`).
- **W5-W1** — deleted the `GroceryLinkWouldBreakError` throw: `aborts the whole recipe rather than
  break a shopping-list link` failed, as before.
- **W5-W2** — replaced the sticky `cookReviewNeeded ... OR ...` with a plain assignment: `never
  clears a cook_review_needed already set by 0041` failed, as before.
- **W5-W3** — dropped `eq(recipes.id, recipeId)` from the final UPDATE: both isolation cases
  (`household` and `everyone`) failed, as before.

**Commit:** `17d19abd` (fix)

### G3 — `backfillCookSource()` could still throw and cost the boot

**Found:** `const units = await getUnits()` and `const ids = await
listRecipeIdsWithoutCookSource()` sat OUTSIDE the per-recipe try/catch. A scratch test making
either reject showed `backfillCookSource()` itself rejects — contradicting R4, the module's own
"NEVER THROWS" docstring, and the SUMMARY's original claim. `apps/web/server/index.ts` awaited it
unguarded under `main().catch(() => process.exit(1))`, so a setup failure would have taken the
whole boot down.

**Fix, both ends:**
- `backfillCookSource()` now initializes a zeroed `CookBackfillOutcome` up front, then wraps
  `getUnits()` and `listRecipeIdsWithoutCookSource()` in the same try/catch style as the loop:
  on failure it logs `reason: "setup-failed"` and returns the zeroed outcome rather than
  rejecting. The function's normal-path behavior (candidates/derived/flagged/refused/failed
  counting) is unchanged.
- `apps/web/server/index.ts` now wraps the call site in its own try/catch as defense in depth, so
  a backfill failure of ANY kind — including one this fix did not anticipate — can never prevent
  the server from booting.

**Proof:** two new tests in `backfill-cook-source.test.ts`
(`describe("G3: the setup calls can never escape backfillCookSource")`) make `getUnits()` and
`listRecipeIdsWithoutCookSource()` reject in turn and assert `backfillCookSource()` still
resolves with `{ candidates: 0, derived: 0, flagged: 0, refused: 0, failed: 0 }`, that
`getRecipeFull` was never called, and that exactly one `error` log line carries
`reason: "setup-failed"`.

**Commit:** `8d056c9c` (fix)

### Gate re-run after all three fixes (final, post-fix state)

| Gate | Baseline (pre-fix) | Post-fix | Verdict |
|---|---|---|---|
| `pnpm --filter @norish/api test` | 430 passed / 31 files | **436 passed / 31 files** (+6: 1 StepWouldBeLostError handling + 3 real-chain collapse + 2 setup-failure) | GREEN |
| `pnpm --filter @norish/db test` | 198 passed / 25 files | **203 passed / 25 files** (+5: 3 step-loss guard + 2 postcheck orphan-proof) | GREEN |
| `pnpm --filter @norish/shared test` | 564 passed / 19 files | **564 passed, 0 failed** (unchanged) | GREEN |
| `pnpm typecheck` | 17/17 EXIT 0 | **17/17 EXIT 0** | GREEN |
| real `tsc --noEmit` in `packages/api` | clean | **EXIT 0, zero output** | GREEN |
| `pnpm --filter @norish/api lint` | 0 err / 97 warn | **0 errors, 97 warnings** | GREEN |
| `pnpm --filter @norish/db lint` | 0 err / 62 warn | **0 errors, 62 warnings** | GREEN |
| `pnpm --filter @norish/shared lint` | 0 err / 45 warn | **0 errors, 45 warnings** | GREEN |
| `check-workspace-imports.mjs` | EXIT 0 | **EXIT 0** | GREEN |
| `pnpm --filter @norish/web build:server` | EXIT 0 | **EXIT 0** | GREEN |
| `git diff pnpm-lock.yaml` | — | **EMPTY (0 lines)** | GREEN |
| `pnpm deps:cycles` | 1 pre-existing cycle (`db-schema/auth.ts -> households.ts`) | **same 1 cycle, unchanged** | GREEN (documented, pre-existing) |
| `git diff --stat apps/web` | `apps/web/server/index.ts` only | **`apps/web/server/index.ts` only** (+8/-1, the try/catch wrapper) | GREEN |
| `_journal.json` / `0042.sql` | 43 entries, DML-free | **unchanged — not touched by this fix pass** | GREEN |

### Fix-pass commits

4. **G1: `checks/0042-postcheck.sql` selected the wrong grocery-link column** - `ab996d47` (fix)
5. **G3: `backfillCookSource` could still throw and cost the boot** - `8d056c9c` (fix)
6. **G2: guard against silent step-row loss and `step_images` cascade** - `17d19abd` (fix)

(G3 was committed before G2 because both touch `backfill-cook-source.ts`; the two fixes are
independent — G3 restructures the setup calls, G2 adds a new catch branch and its imports — and
were staged as two separate, self-contained diffs of the same file rather than one combined
commit.)

**Task 4 (the live run) was still NOT executed in this fix pass** — no docker build, no deploy,
no live stack or live DB access. Live remains untouched.

## Files Created/Modified

- `packages/db/src/repositories/cook-backfill.ts` - `applyCookBackfill`, `GroceryLinkWouldBreakError`, `StepWouldBeLostError` (fix pass), `listRecipeIdsWithoutCookSource`, `CookBackfillWrite`
- `packages/db/src/repositories/index.ts` - barrel export for the above
- `packages/db/__tests__/server/db/repositories/cook-backfill.test.ts` - 13 real-Postgres tests (FK survival, step-id survival, idempotency, sticky flag, guard rollback, isolation under both policies, + 3 step-loss guard tests from the fix pass)
- `packages/shared/src/cooklang/serialize.ts` - additive `hasNameAnchor` export
- `packages/shared/src/cooklang/index.ts` - re-export
- `packages/api/src/startup/backfill-cook-source.ts` - `backfillCookSource` (setup calls now guarded, fix pass G3), `buildStructuredRecipeFromLegacy`, `cookConfidenceFromLinks`, `COOK_REVIEW_CONFIDENCE_THRESHOLD`
- `packages/api/__tests__/startup/backfill-cook-source.test.ts` - 28 tests incl. the escaping proof against the real serializer + real WASM parser, + 6 from the fix pass (1 StepWouldBeLostError handling, 3 real-chain step-collapse proofs, 2 setup-failure)
- `packages/db/src/migrations/0042_backfill_cook_source.sql` - the forward-only, journal-only precondition migration (untouched by the fix pass)
- `packages/db/src/migrations/meta/_journal.json` - 43 entries, last tag `0042_backfill_cook_source` (untouched by the fix pass)
- `packages/db/src/migrations/checks/0042-postcheck.sql` - read-only PRE/POST pair for the live run (fix pass G1: corrected column)
- `packages/db/__tests__/server/db/migrations/0042-backfill-cook-source.test.ts` - 7 tests (5 original precondition/journal/DML tests + 2 from the fix pass proving the postcheck anti-join)
- `apps/web/server/index.ts` - boot wiring: `backfillCookSource()` after `migrateGalleryImages()`, before `initializeVideoProcessing()` (fix pass G3: call site now wrapped in try/catch)

## Decisions Made

- **D-27-W5-07 evidence recorded, not re-decided.** Re-ran `pnpm --filter @norish/api test cook-payload` (Task 2, action (d) of the plan): the D-27-W3-07 measurement now reports **15 of 35** ingredient unit differences across the five fixtures (pancakes 3/5, bolognese 3/9, guacamole 1/6, cookies 3/8, curry 5/7) — down from 18/35 at W3, reflecting W5-PREP's unit-vocabulary and rounding-rule work, but still non-zero on every fixture. Per the plan's explicit instruction, this evidence is recorded but the dual-vs-single-system extraction decision is **not** reopened here — that remains the director's call, out of this plan's scope.
- **Environment fix, not a deviation, not committed:** `node_modules/@norish/config/package.json` was missing the `./units-config` export subpath that an earlier plan (`27-06`, W5-PREP) added to `packages/config/package.json` — a hardlink-farm-adjacent staleness in a file that is not itself under `src/` and so is not covered by the `cp -a .../src/. .../src/` re-sync convention. This blocked the real `pnpm exec tsc --noEmit` gate inside `packages/api` (confirmed reproducible before my Task 2 changes by temporarily removing the new file and re-running — the error persisted). Re-synced the `package.json` from source to `node_modules`; this is local environment state only, not a source-tree change, and was not committed.
- **The two data-quality findings the verifier raised (ingredient names appended into stored `steps.step`; ~40% of opposite-system amounts rewritten by `deriveConversion`'s flag-and-preserve) were explicitly ACCEPTED by Kiran on 2026-07-27, per Architecture §8 / D-27-W5-07, and are NOT reopened or guarded against by this fix pass.** Recorded here so a future reader does not mistake an accepted, signed-off consequence for an unfixed gap.

## Deviations from Plan

None beyond the environment fix noted above (which touches no tracked file). Both Task 1's and Task 2's isolation/adversarial tests found and closed one real coverage gap during the required adversarial revert-check process itself (see below) — not a deviation from the plan's instructions, but worth recording since it changed the shape of the isolation test.

The post-verification fix pass itself (G1/G2/G3, documented above under "Post-Verification Fix
Pass") is not a deviation — it is this session's explicit objective, closing the 3 BLOCKER gaps
`27-07-VERIFICATION.md` found before Task 4 (the live run) may proceed.

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

- **Task 4 (the live run) is ready to execute, and the independent verifier's NO-GO is now resolved.** `27-07-VERIFICATION.md` found 3 BLOCKER gaps (G1/G2/G3) and returned a `NO-GO for the live run until G1 is fixed and G2/G3 are dispositioned by the director`; all three are closed by this fix pass (see "Post-Verification Fix Pass" above), with independent adversarial proof for each and all hard gates re-verified green at or above baseline. `checks/0042-postcheck.sql` now has a correct PRE/POST anti-join, `applyCookBackfill` now guards both the grocery-link and the step-row/step_images families the must-have truth names, and `backfillCookSource()` genuinely never throws (both the function itself and its call site are guarded).
- **The two data-quality warnings the verifier raised (appended ingredient names in step prose; opposite-system amount rewriting) remain — Kiran explicitly accepted both on 2026-07-27 as designed (Architecture §8). They are not blockers and this fix pass does not touch them.**
- **Blocker for Task 4:** none from this plan's side — it is gated on the director dispatching the separate deploy agent per the plan's `checkpoint:human-verify` protocol (verified-restorable `pg_dump` first, then `docker:build`, deploy, PRE/POST diff, and the second-restart idempotence check). This fix-pass session did NOT execute Task 4 — no docker build, no deploy, no live stack or live DB access.
- **W6 (the NOT NULL contract)** remains unscoped beyond `27-ARCHITECTURE.md` §7 and is unaffected by this plan.

---
*Phase: 27-cooklang*
*Plan: 07 (Tasks 1-3 of 4 code-complete + post-verification fix pass — Task 4 pending, owned by a separate deploy agent)*
*Completed: 2026-07-27*

## Self-Check: PASSED

- Commit hashes `ab996d47`, `8d056c9c`, `17d19abd` (this fix pass) and `0d770c65`, `0af791f8`,
  `e56bad7f` (original Tasks 1-3) all found in `git log --oneline --all`.
- All files referenced above (`cook-backfill.ts`, `0042-postcheck.sql`,
  `backfill-cook-source.ts`, `apps/web/server/index.ts`, and the three test files) confirmed to
  exist on disk.
- Final gate re-run confirmed green in this session: `@norish/api` 436/436, `@norish/db` 203/203,
  `@norish/shared` 564/564, `pnpm typecheck` 17/17, real `tsc --noEmit` in `packages/api` clean,
  lint 0 errors at 97/62/45 warnings, `check-workspace-imports.mjs` exit 0, `build:server` exit 0,
  `git diff pnpm-lock.yaml` empty, `deps:cycles` only the pre-existing documented cycle.
