---
phase: 02-multi-household
plan: 03
subsystem: auth
tags: [permissions, isolation, security, trpc, drizzle, postgres, households, multi-tenant, testing, vitest]

requires:
  - phase: 02-multi-household
    provides: ctx.memberHouseholdIds (middleware), RecipeListContext.activeHouseholdId/memberHouseholdIds + buildViewPolicyCondition household scoping, recipes.household_id, recipe zod householdId, recipeExistsByUrlForPolicy/findExistingRecipe per-cookbook dedup
provides:
  - Per-cookbook permission boundary in permissions.ts (canAccessResource takes resourceHouseholdId + requesterMemberHouseholdIds; household level = requester must be a member of the recipe's own cookbook; NULL household = owner-only)
  - Recipe helpers (assertRecipeAccess/findRecipeForViewer) + the convert mutation pass the recipe's householdId + ctx.memberHouseholdIds into canAccessResource end-to-end
  - getRecipeOwnerAndHousehold repo helper (owner + cookbook in one read)
  - getRecipeFull/dashboardRecipe/listRecipes now select + map householdId (FullRecipeDTO/RecipeDashboardDTO are valid again post-02-01)
  - Dedicated cross-cookbook isolation suites at DB-scoping (households.isolation.test.ts) and tRPC (permissions-integration.test.ts "cross-cookbook isolation") levels, adversarially verified RED-when-weakened
  - All three suites green: @norish/auth, @norish/trpc, and the @norish/db cookbook/contract failures cleared (49 db + 32 trpc + 4 auth claim-processor now 0)
affects: [02-04-frontend-i18n]

tech-stack:
  added: []
  patterns:
    - "Per-cookbook isolation enforced in TWO independent server-side layers: canAccessResource (item access) AND buildViewPolicyCondition (list/query scoping); each has its own isolation suite and each goes RED when its layer is weakened"
    - "canAccessResource signature is cookbook-aware: (action, userId, ownerId, resourceHouseholdId, requesterMemberHouseholdIds, isServerAdmin); household level => resourceHouseholdId !== null && requesterMemberHouseholdIds.includes(resourceHouseholdId)"
    - "Real-boundary integration tests: permissions-integration.test.ts exercises the REAL canAccessResource via assertRecipeAccess/findRecipeForViewer (mocking only the repo/config deps), not a vi.fn stub of the function under test"

key-files:
  created:
    - packages/db/__tests__/server/db/repositories/households.isolation.test.ts
  modified:
    - packages/auth/src/permissions.ts
    - packages/trpc/src/routers/recipes/helpers.ts
    - packages/trpc/src/routers/recipes/recipes.ts
    - packages/db/src/repositories/recipes.ts
    - packages/auth/__tests__/permissions.test.ts
    - packages/auth/__tests__/auth/claim-processor.test.ts
    - packages/trpc/__tests__/recipes/permissions-integration.test.ts
    - packages/trpc/__tests__/recipes/recipes.test.ts
    - packages/trpc/__tests__/recipes/test-utils.ts
    - packages/trpc/__tests__/user/test-utils.ts
    - packages/trpc/__tests__/groceries/test-utils.ts
    - packages/trpc/__tests__/calendar/test-utils.ts
    - packages/trpc/__tests__/admin/test-utils.ts
    - packages/shared/__tests__/helpers/mocks.ts
    - packages/trpc/__tests__/mocks/db.ts
    - packages/trpc/__tests__/mocks/user-repository.ts
    - packages/trpc/__tests__/recipes/shares.test.ts
    - packages/trpc/__tests__/user/user-procedures-get.test.ts
    - packages/trpc/__tests__/households/households-stale.test.ts
    - packages/trpc/__tests__/favorites/favorites.test.ts
    - packages/trpc/__tests__/ratings/ratings.test.ts
    - packages/trpc/__tests__/stores/stores.test.ts
    - packages/trpc/__tests__/calendar/planned-items.test.ts
    - packages/trpc/__tests__/calendar/planned-items-stale.test.ts
    - packages/trpc/__tests__/archive/archive-import-validation.test.ts
    - packages/trpc/__tests__/recipes/paste-import.test.ts
    - packages/db/__tests__/helpers/db-test-helpers.ts
    - packages/db/__tests__/server/db/repositories/ingredient-unit-normalization.test.ts
    - packages/db/__tests__/server/db/repositories/users-preferences.test.ts
    - packages/db/__tests__/server/db/repositories/server-config-normalization.test.ts
    - packages/db/package.json

key-decisions:
  - "canAccessResource household branch: requester may access ONLY IF resourceHouseholdId is non-null AND requesterMemberHouseholdIds.includes(resourceHouseholdId). A NULL household (personal recipe) is owner-only (returns false for non-owners). Owner and server-admin short-circuit to true before the policy switch."
  - "canAccessHouseholdResource (groceries/calendar/stores item access) kept UNCHANGED (2-arg, member-overlap via getHouseholdForUser). Those item types do not carry a household_id and are scoped to the active household's members via ctx.userIds upstream; the plan explicitly permits keeping the member-overlap semantics. Avoids editing 5 unrelated router files out of plan scope."
  - "permissions-integration.test.ts was rewritten to use the REAL canAccessResource (via assertRecipeAccess/findRecipeForViewer) instead of the vi.fn mock it previously used. A test that stubs the function under test cannot prove the boundary; the real-boundary approach is what the adversarial sanity check bites on. Consolidated the Task-4 signature updates and the Task-5 cross-cookbook block into this single coherent file (it is listed in both tasks)."
  - "Two enforcement layers, two suites: households.isolation.test.ts proves the DB-scoping layer (buildViewPolicyCondition + recipeExistsByUrlForPolicy); permissions-integration.test.ts proves the permission layer (canAccessResource). Weakening canAccessResource turns the tRPC suite RED but NOT the DB suite (defense-in-depth); weakening buildViewPolicyCondition turns the DB suite RED — both verified."
  - "The deferred 49 @norish/db failures were actually a production bug from 02-01: getRecipeFull built its DTO WITHOUT householdId while 02-01 made householdId required on RecipeSelectBaseSchema -> FullRecipeSchema.parse threw 'Failed to parse FullRecipeDTO'. Fixed by selecting + mapping householdId in getRecipeFull, dashboardRecipe and listRecipes (production fix, not just a test-factory tweak)."

patterns-established:
  - "Per-cookbook isolation is enforced + tested at both the access-check layer and the query-scoping layer; each layer has a dedicated suite that fails closed when that layer is removed"
  - "When the recipe is fully in hand, pass recipe.householdId into canAccessResource; otherwise fetch owner+household via getRecipeOwnerAndHousehold"

requirements-completed: [HOUSE-06]

duration: ~3h
completed: 2026-06-13
---

# Phase 02 Plan 03: Permissions + Per-Cookbook Isolation Tests Summary

**Enforced the security-critical per-cookbook visibility boundary (HOUSE-06) server-side — canAccessResource now keys on the recipe's household_id + the requester's member household ids — and proved it regression-proof with dedicated DB-scoping and tRPC isolation suites that were adversarially verified to fail closed; also cleared the 49 db + 32 trpc + 4 auth contract failures 02-02 deferred and fixed a latent per-cookbook dedup bug.**

## Performance

- **Duration:** ~3h
- **Completed:** 2026-06-13
- **Tasks:** 5
- **Files modified:** 31 (1 created)

## Accomplishments
- **Task 1 — boundary:** `canAccessResource(action, userId, ownerId, resourceHouseholdId, requesterMemberHouseholdIds, isServerAdmin)`. `household` level => `resourceHouseholdId !== null && requesterMemberHouseholdIds.includes(resourceHouseholdId)`; NULL household is owner-only. `canAccessHouseholdResource` kept unchanged (correct for non-recipe, household_id-less items).
- **Task 2 — helpers/router:** added `getRecipeOwnerAndHousehold`; `assertRecipeAccess`/`findRecipeForViewer` + the convert mutation pass `recipe.householdId` (or the fetched value) + `ctx.memberHouseholdIds`; `RecipeUserContext` gained `memberHouseholdIds`. Also fixed `getRecipeFull`/`dashboardRecipe`/`listRecipes` to select + map `householdId` (the real cause of the 49 db failures).
- **Task 3 — fixtures:** all five tRPC test-utils + the shared mocks build `activeHouseholdId` + `memberHouseholdIds`; recipe DTO factories build `householdId`.
- **Task 4 — existing suites:** auth permissions.test.ts + recipes.test.ts + the claim-processor suite updated to the cookbook model; the 32 trpc + 4 auth contract failures resolved (getHouseholdsForUser stubbed wherever the real withAuth middleware runs); the createRecipeWithRefs arity + two pre-existing db fixture/contract failures fixed.
- **Task 5 — isolation suites:** `households.isolation.test.ts` (168 lines, 6 tests) proves DB-level cross-cookbook NON-visibility + personal + orphan + dedup isolation; `permissions-integration.test.ts` rewritten to a real-boundary integration test (16 tests) with a "cross-cookbook isolation" block asserting FORBIDDEN for view/edit/delete on a non-member cookbook's recipe. A latent per-cookbook dedup bug was found + fixed.

## Task Commits

1. **Task 1: per-cookbook canAccessResource boundary** - `168ccfae` (feat)
2. **Task 2: pass recipe householdId through recipe helpers** - `ec0c9f94` (feat)
3. **Task 3: build active-household ctx fields in test-utils** - `2feceebf` (test)
4. **Task 4: update permission/recipe suites for cookbook model** - `e963d22a` (test)
5. **Dedup fix: per-cookbook dedup never matched (undefined vs null)** - `9897639d` (fix)
6. **Task 5: cross-cookbook isolation suites (db + trpc)** - `f81da2bc` (test)
7. **db test script (so the suite runs via filter)** - `efc1e202` (test)

**Plan metadata:** SUMMARY commit (docs) + STATE/ROADMAP/REQUIREMENTS update commit (docs)

## Adversarial Sanity Check (security wave — performed)

Both enforcement layers were weakened, confirmed RED, reverted, confirmed GREEN. The weakened versions were NEVER committed (verified `git diff` after revert shows only the legitimate dedup fix).

- **Access layer** — temporarily made `canAccessResource`'s `household` branch `return true`:
  - `permissions-integration.test.ts` -> **RED**: `Tests 6 failed | 10 passed (16)` (the 6 cross-cookbook FORBIDDEN/null-view tests failed: "promise resolved 'undefined' instead of rejecting", "expected {…} to be null").
  - Reverted -> **GREEN**: `Tests 16 passed (16)`.
  - (`households.isolation.test.ts` correctly STAYED green — it tests the DB-scoping layer, not canAccessResource: defense-in-depth.)
- **Query-scoping layer** — temporarily made `buildViewPolicyCondition`'s `household` branch `return undefined` (no cookbook filter):
  - `households.isolation.test.ts` -> **RED**: `Tests 3 failed | 3 passed (6)` ("expected [ … ] to not include '<recipeB-id>'").
  - Reverted -> **GREEN**: `Tests 6 passed (6)`.

## Verification Results (final, quoted)

Typecheck (all EXIT=0, 0 error-TS lines; @norish/db + @norish/shared are real `tsc --noEmit`):
- @norish/auth ✓  @norish/db ✓  @norish/trpc ✓  @norish/shared ✓

Tests:
- `@norish/auth`: `Test Files 4 passed (4)` / `Tests 61 passed (61)` — was 4 failed/56; the 4 claim-processor failures now 0.
- `@norish/trpc`: `Test Files 24 passed (24)` / `Tests 223 passed (223)` — was 12 failed/32 failed-tests; the 32 contract failures now 0.
- `@norish/db`: `Test Files 1 failed | 13 passed (14)` / `Tests 3 failed | 75 passed (78)` — the prior 49 cookbook/contract failures now 0; the new households.isolation.test.ts passes; the only 3 remaining failures are PRE-EXISTING and OUT OF SCOPE (see Deviations + Issues).

Lint (touched packages, all EXIT=0 / 0 errors): @norish/auth, @norish/db, @norish/trpc, @norish/shared. The only warnings are pre-existing and in untouched files/lines (`recipes.ts:61 nonEmpty` dead helper, `tags.ts:166`, `shared/src/lib/logger.ts` console). My changes add 0 new lint errors/warnings.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] getRecipeFull/dashboardRecipe/listRecipes did not select/map householdId**
- **Found during:** Task 2 (the "deferred 49 db failures").
- **Issue:** 02-01 made `householdId` required on `RecipeSelectBaseSchema` (→ `FullRecipeSchema`/`RecipeDashboardSchema`), but `getRecipeFull` built its DTO without it → `FullRecipeSchema.parse` threw "Failed to parse FullRecipeDTO" through every db suite using `RepositoryTestBase`. `dashboardRecipe`/`listRecipes` had the same omission (silently null-returning on safeParse). The plan framed this as a test-factory tweak, but the real fix is production.
- **Fix:** added `householdId` to the `columns` select + the DTO mapping in `getRecipeFull`, `dashboardRecipe`, and `listRecipes`.
- **Files modified:** packages/db/src/repositories/recipes.ts
- **Verification:** @norish/db real `tsc --noEmit` clean; the db cascade failures cleared; the new isolation suite (which lists recipes) passes.
- **Committed in:** `ec0c9f94` (Task 2 commit)

**2. [Rule 1 - Bug found during testing] Per-cookbook dedup never isolated (exists always true)**
- **Found during:** Task 5 (the households.isolation dedup test).
- **Issue:** `recipeExistsByUrlForPolicy` returned `{ exists: existing !== null }`, but drizzle `findFirst` returns `undefined` (not `null`) on no match → `undefined !== null === true`, so `exists` was ALWAYS true regardless of cookbook. This defeats the security-critical per-cookbook dedup (D-13) and would mis-report cross-cookbook URL collisions. Pre-existing since upstream RC v0.17.0 (`bb003e9a`), exposed by the new isolation test.
- **Fix:** `exists: existing != null` (handles both null and undefined).
- **Files modified:** packages/db/src/repositories/recipes.ts
- **Verification:** households.isolation.test.ts dedup case (`recipeExistsByUrlForPolicy(url, V, cookbookB, …)` => exists:false; same url in cookbook A => exists:true) now passes; control + bogus-url checks confirmed the fix.
- **Committed in:** `9897639d` (fix commit)

**3. [Rule 2 - Missing critical] @norish/db had no `test` script (verification command was a silent no-op)**
- **Found during:** Final verification.
- **Issue:** `pnpm --filter @norish/db test` exited 0 with no output because `@norish/db/package.json` had no `test` script (so the required verification — and the new isolation suite — never ran via the filter; the suite is run by `vitest run` directly).
- **Fix:** added `"test": "vitest run --config ./vitest.config.ts"` to packages/db/package.json (matches auth/trpc/shared). The db suite uses testcontainers postgres (Docker present on 110; the live norish-db was never touched).
- **Files modified:** packages/db/package.json
- **Verification:** `pnpm --filter @norish/db test` now runs the full suite.
- **Committed in:** `efc1e202` (test commit)

**4. [Rule 1 - Contract/fixture drift] claim-processor + ingredient-arity + 2 pre-existing db fixtures updated to clear all suites**
- **Found during:** Task 4 / final db run.
- **Issue:** (a) `claim-processor.test.ts` mock lacked `getHouseholdsForUser`/`setActiveHousehold` (02-02 changed the OIDC path) — 4 auth failures the 02-02 summary missed. (b) 5 `createRecipeWithRefs(id, userId, {…})` calls in ingredient-unit-normalization used the old 3-arg form (now needs the `householdId` param). (c) `users-preferences.test.ts` still asserted `db.execute` though 02-02 moved `updateUserPreferences` to `db.update(...).returning()`. (d) `server-config-normalization.test.ts` expected an AI-config object missing the upstream `timeoutMs` field (drift since RC v0.18.0). All four are the same class as the deferred contract failures and must be green per the "all three suites pass" requirement.
- **Fix:** added the missing household mocks + updated the 4 affected claim-processor tests; inserted `null` householdId into the 5 arity calls; rewrote the users-preferences mock/assertions to the `db.update` chain; added `timeoutMs: 300000` to the two server-config expected objects.
- **Files modified:** packages/auth/__tests__/auth/claim-processor.test.ts, packages/db/__tests__/server/db/repositories/{ingredient-unit-normalization,users-preferences,server-config-normalization}.test.ts
- **Verification:** auth 61/61 green; the 3 db files pass in isolation and in the full run.
- **Committed in:** `e963d22a` (Task 4) + the arity/db-fixture fixes folded into the same commit.

**5. [Scope boundary — NOT auto-fixed] 3 pre-existing updateRecipeWithRefs unit-normalization failures left as-is**
- **Found during:** Final db run.
- **Issue:** `syncRecipeIngredientsTx` (the update path) does NOT apply `normalizeUnit`, while the create path (`attachIngredientsToRecipeByInputTx`) does, so 3 tests assert e.g. `handvol`→`handful` and fail on update. Confirmed PRE-EXISTING (introduced upstream RC v0.18.0 `80d8c1b8`; I touched neither `syncRecipeIngredientsTx` nor the test — `git diff 86019ae4 HEAD` empty for that code) and UNRELATED to households/HOUSE-06. Per the execute-plan scope-boundary rule, a real production-logic bug in an unrelated function is not auto-fixed inside a security plan; fixing it means loading the units config into the ingredient-sync path (touches the live recipe-edit flow).
- **Action:** left red and documented; spawned a separate background task to fix the normalization parity properly.

---

**Total deviations:** 4 auto-fixed (2 missing-critical, 1 bug, 1 contract/fixture-drift incl. a pre-existing db.update + AI-config drift), 1 documented-not-fixed (pre-existing out-of-scope logic bug). **Impact:** The auto-fixes were required to enforce HOUSE-06 (the dedup bug + getRecipeFull) and to satisfy the wave's "all three suites green" mandate; no production code was weakened. The 3 untouched failures are an orthogonal pre-existing bug carried to a follow-up task.

## Issues Encountered

### 3 pre-existing @norish/db failures (out of scope)
`updateRecipeWithRefs - unit normalization` (3 tests) fail because `syncRecipeIngredientsTx` skips `normalizeUnit`. Pre-existing (upstream RC v0.18.0), unrelated to the multi-household work, and not the contract class the plan deferred. Left red; spawned a follow-up task to fix the create/update normalization parity.

### node_modules hardlink farm
`recipes.ts` lost its inode hardlink to `node_modules/@norish/trpc/...` when an edit replaced the file; re-synced with `cp -a` per the environment note, then re-ran the real `tsc` to confirm the convert-mutation signature fix is live. `helpers.ts` kept its hardlink (edited in place).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **HOUSE-06 complete and regression-proof.** Ready for **Plan 02-04** (frontend switcher + assign-to-cookbook UX + i18n; has a human-verify checkpoint). 02-04 builds the navbar cookbook switcher (+Personal option) and the import assign-to-cookbook selector on top of the now-enforced backend boundary; the i18n gate requires new keys in ALL 11 locales.
- **Follow-up (non-blocking):** the spawned task to fix `syncRecipeIngredientsTx` unit normalization (3 pre-existing db tests).

## Self-Check: PASSED

Re-ran every task's `<acceptance_criteria>` + the plan-level `<verification>`:
- Task 1: canAccessResource takes resourceHouseholdId + requesterMemberHouseholdIds; household branch checks `includes(resourceHouseholdId)` and rejects null; @norish/auth typechecks. PASS
- Task 2: helpers.ts passes recipe householdId + ctx.memberHouseholdIds into canAccessResource; the only canAccessResource call site in recipes.ts (convert mutation) uses the new 6-arg signature; RecipeUserContext has memberHouseholdIds; @norish/db + @norish/trpc typecheck. PASS
- Task 3: all five trpc test-utils + shared mocks build activeHouseholdId + memberHouseholdIds; @norish/trpc + @norish/shared typecheck; the suites compile + run. PASS
- Task 4: permissions.test.ts + permissions-integration.test.ts + recipes.test.ts compile and pass with the new signature; no test calls the old 5-arg canAccessResource; @norish/auth test green; @norish/trpc recipes suites green. PASS
- Task 5: households.isolation.test.ts exists (168 lines >= 40) and passes (cross-cookbook non-visibility + personal + orphan + dedup isolation); permissions-integration.test.ts has a "cross-cookbook isolation" block asserting FORBIDDEN for view/edit/delete on a non-member cookbook; both suites pass. PASS
- `<verification>`: @norish/auth + @norish/trpc + (cookbook/contract part of) @norish/db green; typecheck green across auth/db/trpc/shared; the isolation suites fail closed when the boundary is removed (adversarial RED→GREEN performed, both layers); lint clean on touched packages (0 new errors/warnings). The 3 remaining @norish/db failures are pre-existing + out of scope (documented). PASS

key-files.created exists on disk (households.isolation.test.ts); `git log --oneline --grep="(02-03)"` shows 7 commits.

---
*Phase: 02-multi-household*
*Completed: 2026-06-13*
