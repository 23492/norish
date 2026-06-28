---
phase: 20-incorporate-upstream-v0-19-0-beta
plan: "03"
subsystem: auth/trpc/shared/shared-react/shared-server
tags: [upstream-merge, auth, trpc, households, recipes, sharing, ratings, permissions, HOUSE-06]
dependency_graph:
  requires: [20-02]
  provides: [auth-trpc-subsystem-resolved]
  affects: [20-04, 20-05, 20-06]
tech_stack:
  patterns:
    - per-cookbook isolation (HOUSE-06): assertRecipeAccess → resolveRecipeCookbookPolicy → canAccessResource(8-arg)
    - visibility auto-promote/revert: markRecipePublic / revertRecipePrivateIfNoActiveShares on share create/revoke/delete
    - SHARE-01 visibility gate: resolveSharedRecipe helper in middleware enforces recipe.visibility === "public"
    - SHARE-02 authenticated save: authedSharedRecipeProcedure uses same resolveSharedRecipe gate
    - multi-household context: withAuth calls getUserHouseholdIds(sub-path, not barrel) → ctx.memberHouseholdIds
key_files:
  created:
    - packages/trpc/__tests__/mocks/households-repository.ts
  modified:
    - packages/auth/__tests__/auth/workos-provider.test.ts
    - packages/shared/src/contracts/zod/recipe.ts
    - packages/shared-react/src/hooks/ratings/index.ts
    - packages/shared-react/src/hooks/households/types.ts
    - packages/shared-react/src/hooks/households/use-household-mutations.ts
    - packages/shared-react/src/contexts/households/household-context.tsx
    - packages/trpc/src/middleware.ts
    - packages/trpc/src/routers/households/households.ts
    - packages/trpc/src/routers/recipes/shares.ts
    - packages/trpc/__tests__/mocks/permissions.ts
    - packages/trpc/__tests__/mocks/recipes-repository.ts
    - packages/trpc/__tests__/recipes/recipes.test.ts
    - packages/trpc/__tests__/recipes/shares.test.ts
    - packages/trpc/__tests__/ratings/raters.test.ts
    - packages/trpc/__tests__/recipes/permissions-integration.test.ts
    - packages/trpc/__tests__/archive/archive-import-validation.test.ts
    - 12 additional trpc test files (getUserHouseholdIds mock fix)
decisions:
  - "SHARE-01 visibility gate moved into resolveSharedRecipe helper in middleware so it applies identically to both sharedRecipeProcedure (anonymous) and authedSharedRecipeProcedure (authenticated save)"
  - "getUserHouseholdIds comes from @norish/db/repositories/households sub-path (not the barrel) — all test mocks updated to the sub-path"
  - "getRecipeOwnerAndHousehold replaces getRecipeOwnerId in assertRecipeAccess (HOUSE-06 per-cookbook boundary); test assertions updated to match new 8-arg canAccessResource signature"
  - "resolveRecipeCookbookPolicy added to permissions mock; getRecipeOwnerAndHousehold added to recipes-repository mock"
metrics:
  duration: "~4 hours (continuation session)"
  completed: "2026-06-28T09:28:34Z"
  tasks_completed: 3
  files_changed: 28
  commit: "962e8123"
---

# Phase 20 Plan 03: auth/trpc/shared/shared-react subsystem delta re-applied

Re-applied the fork's multi-household/sharing/ratings/permissions delta onto the 13 upstream-Strategy-B files in the auth/trpc/shared/shared-react subsystem. Auth suite: 129/129 passing. tRPC suite: 269/269 passing (all 27 files). Adversarial boundary check: cross-cookbook isolation tests went RED when `canAccessResource` was forced to always return `true`; reverted byte-identical; confirmed GREEN. `git diff packages/auth/src/permissions.ts` was empty before commit.

## Tasks Completed

### Task 1: Verify auto-merged core auth files
All acceptance criteria passed without any file modifications:
- `buildWorkOSProviders`, `addUserToHousehold`, `setActiveHousehold` present in auth.ts
- `canAccessResource`, `resolveRecipeCookbookPolicy`, `buildViewPolicyCondition` present in permissions.ts
- `claim-processor.ts` uses `@norish/shared-server/realtime` + `@norish/shared-server/cache` paths
- `pnpm --filter @norish/auth test`: 129/129 passing (after deviation fixes — see below)

### Task 2: Re-apply fork delta onto 13 Strategy-B files
All 13 files updated. Key re-applications:
- **shared/recipe.ts**: `RecipeVisibilitySchema`, `SetRecipeVisibilityInputSchema`, `RecipeVisibilityResultSchema`, `householdId`/`visibility` fields on base schemas
- **shared-react/hooks/ratings**: `createUseRecipeRatersQuery` export re-applied
- **shared-react/hooks/households/types.ts**: `HouseholdsListResult`, extended `HouseholdMutationsResult` with rename/setPolicy/switchActive/generateInviteToken/joinByInviteToken
- **shared-react/hooks/households/use-household-mutations.ts**: full fork content with all 5 extra mutations
- **shared-react/contexts/households/household-context.tsx**: `HouseholdContextValue` extended with multi-household fields
- **trpc/routers/households/households.ts**: full fork router with `resolveHouseholdDto` + all procedures
- **trpc/middleware.ts**: added `resolveSharedRecipe` helper (SHARE-01 visibility gate) + `authedSharedRecipeProcedure` (SHARE-02)
- **trpc/routers/recipes/shares.ts**: added `markRecipePublic`/`revertRecipePrivateIfNoActiveShares` helpers, auto-promote/revert on create/revoke/delete, `setVisibility` procedure, `saveShared` procedure; updated router export

### Task 3: Typecheck + test + adversarial check
- `pnpm --filter @norish/auth --filter @norish/trpc --filter @norish/shared --filter @norish/shared-react --filter @norish/shared-server typecheck`: all clean
- `pnpm --filter @norish/auth test`: 129/129 passing
- `sg docker -c 'pnpm --filter @norish/trpc test'`: 269/269 passing (27 files)
  - Including `__tests__/recipes/permissions-integration.test.ts` (27 tests)
  - Including `__tests__/ratings/raters.test.ts`
- **Adversarial check PASSED**: weakened `canAccessResource` to always return `true` → 12 isolation tests went RED (cross-cookbook block + raters access-gate) → reverted byte-identical → 27 tests GREEN → `git diff packages/auth/src/permissions.ts` empty

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] workos-provider.test.ts: mock paths broken after module-boundary moves**
- **Found during:** Task 1 auth test run
- **Issue:** `vi.mock("@norish/config/server-config-loader")` — deleted module; `vi.mock("@norish/queue/redis/client")` — moved module. Redis client also imports `createLogger` from logger, missing from logger mock.
- **Fix:** Changed to `@norish/shared-server/config/server-config-loader` and `@norish/shared-server/redis/client`; added `createLogger` to logger mock.
- **Files:** `packages/auth/__tests__/auth/workos-provider.test.ts`

**2. [Rule 3 - Blocking] permissions-integration.test.ts: @norish/config/server-config-loader mock path**
- **Found during:** Task 3 first trpc test run
- **Fix:** Changed to `@norish/shared-server/config/server-config-loader`
- **Files:** `packages/trpc/__tests__/recipes/permissions-integration.test.ts`

**3. [Rule 3 - Blocking] raters.test.ts: wrong middleware dependency mock**
- **Found during:** Task 3 trpc test run
- **Issue:** `withAuth` middleware calls `getUserHouseholdIds` from `@norish/db/repositories/households` sub-path (returns `string[]`), not `getHouseholdsForUser` from the barrel (returns objects). Only sub-path mock matters.
- **Fix:** Added hoisted `getUserHouseholdIdsMock`, added to `@norish/db/repositories/households` mock, set up membership map in `beforeEach`.
- **Files:** `packages/trpc/__tests__/ratings/raters.test.ts`

**4. [Rule 3 - Blocking] 13 trpc test files: @norish/db barrel mock missing getUserHouseholdIds sub-path**
- **Found during:** Task 3 — ECONNREFUSED to :5432 from withAuth calling getUserHouseholdIds → DB
- **Issue:** All tests mocked `@norish/db` barrel but `withAuth` calls `getUserHouseholdIds` from `@norish/db/repositories/households` (sub-path). Sub-path was not mocked → real DB call → connection refused.
- **Fix:** Created `packages/trpc/__tests__/mocks/households-repository.ts` with `getUserHouseholdIds = vi.fn(() => Promise.resolve([]))`, added `vi.mock("@norish/db/repositories/households", () => import("../mocks/households-repository"))` to all 13 affected files.
- **Files:** `packages/trpc/__tests__/mocks/households-repository.ts` (NEW), plus 13 test files

**5. [Rule 3 - Blocking] recipes.test.ts: getEditable tests use old assertRecipeAccess API**
- **Found during:** Task 3 — `No "getRecipeOwnerAndHousehold" export is defined on the "@norish/db" mock`
- **Issue:** `assertRecipeAccess` was re-implemented in Task 2 to use `getRecipeOwnerAndHousehold` + `resolveRecipeCookbookPolicy` (HOUSE-06 8-arg `canAccessResource`). The upstream-Strategy-B `recipes.test.ts` still used the old `getRecipeOwnerId` API and old 5-arg `canAccessResource` assertion. Also `memberHouseholdIds` was being overwritten by `withAuth` middleware to `[]` (from the unset mock).
- **Fix:** Added `getRecipeOwnerAndHousehold` to `@norish/db` mock and `recipes-repository` mock; added `resolveRecipeCookbookPolicy` to permissions mock; updated `getEditable` test assertions to new 8-arg `canAccessResource` signature; set `getUserHouseholdIds.mockResolvedValue([mockHousehold.id])` in `beforeEach`.
- **Files:** `packages/trpc/__tests__/mocks/recipes-repository.ts`, `packages/trpc/__tests__/mocks/permissions.ts`, `packages/trpc/__tests__/recipes/recipes.test.ts`

**6. [Rule 3 - Blocking] shares.ts: setVisibility + saveShared procedures missing (Task 2 gap)**
- **Found during:** Task 3 — `No procedure found on path "shareSetVisibility"` / `"saveShared"`
- **Issue:** Task 2 (prior session) missed re-applying `setVisibility` (SHARE-01 edit gate) and `saveShared` (SHARE-02) procedures to shares.ts. Also missed `markRecipePublic`/`revertRecipePrivateIfNoActiveShares` helpers and the visibility auto-promote/revert calls in create/revoke/delete.
- **Fix:** Added all missing imports (`copyRecipeForSave`, `countActiveRecipeShares`, `dashboardRecipe`, `getRecipeFull`, `getRecipeVisibility`, `setRecipeVisibility`, `copyRecipeImagesDir`, `authedSharedRecipeProcedure`, `SaveSharedRecipeResultSchema`, `SetRecipeVisibilityInputSchema`, `RecipeVisibilityResultSchema`); added both helper functions and both procedures; updated router export.
- **Files:** `packages/trpc/src/routers/recipes/shares.ts`

**7. [Rule 3 - Blocking] middleware.ts: authedSharedRecipeProcedure missing + sharedRecipeProcedure missing SHARE-01 visibility gate (Task 2 gap)**
- **Found during:** Task 3 — `TypeError: Cannot read properties of undefined (reading 'output')` on shares.test.ts module load
- **Issue:** `authedSharedRecipeProcedure` was not re-applied to middleware. Also the upstream `sharedRecipeProcedure` has no visibility gate — the fork's version used `resolveSharedRecipe` helper that checked `recipe.visibility !== "public"` (SHARE-01).
- **Fix:** Extracted `resolveSharedRecipe` helper with SHARE-01 visibility check; updated `sharedRecipeProcedure` to use it; added `authedSharedRecipeProcedure` as `authedProcedure.input(ResolveSharedRecipeInputSchema).use(resolveSharedRecipe)`.
- **Files:** `packages/trpc/src/middleware.ts`

**8. [Rule 3 - Blocking] shares.test.ts: getUserHouseholdIds mock causing memberHouseholdIds mismatch**
- **Found during:** Task 3 — `memberHouseholdIds: []` instead of `["test-household-id"]` in assertRecipeAccess assertion
- **Issue:** `withAuth` overwrites `memberHouseholdIds` from `getUserHouseholdIds` mock (returning `[]`). shares.test.ts had `@norish/db/repositories/households` mocked via the auto-mock (returning `[]`) but test asserts `authedCtx` which has `memberHouseholdIds: ["test-household-id"]`.
- **Fix:** Added hoisted `getUserHouseholdIdsMock`, replaced auto-mock with inline mock, set `getUserHouseholdIdsMock.mockResolvedValue([household.id])` in `beforeEach`.
- **Files:** `packages/trpc/__tests__/recipes/shares.test.ts`

## Scope Notes (20-05 owned)

No source files importing the deleted `@norish/config/server-config-loader` remain (all source files have been migrated). `@norish/config/zod/server-config` (Zod schema types) and `@norish/config/env-config-server`/`@norish/config/crypto` (environment config) are separate packages that still exist — these are NOT in scope for 20-03 or 20-05.

## Known Stubs

None — all procedures are fully implemented with real DB repository calls.

## Adversarial Check Report

- **Weakened:** `canAccessResource` in `packages/auth/src/permissions.ts` forced to `return true` unconditionally (2-line change: added `return true;` before `if (userId === ownerId || isServerAdmin) return true;`)
- **RED tests:** 12 failures in `permissions-integration.test.ts` (cross-cookbook isolation: FORBIDS member-of-only-B from A's recipe, personal-recipe owner-only, non-admin member cannot delete another member's recipe) + `raters.test.ts` (access-gate tests)
- **Revert:** Removed the `return true;` line → byte-identical to pre-weakening
- **GREEN:** All 27 tests in permissions-integration + raters confirmed green
- **git diff:** `git diff packages/auth/src/permissions.ts` produced no output — weakening not committed

## Self-Check

All 28 staged files were committed as `962e8123`.

Existence checks:
- `packages/trpc/__tests__/mocks/households-repository.ts` — FOUND (new file, `A` in git status)
- `packages/trpc/src/routers/recipes/shares.ts` — FOUND (setVisibility, saveShared, markRecipePublic present)
- `packages/trpc/src/middleware.ts` — FOUND (authedSharedRecipeProcedure, resolveSharedRecipe present)

Commit check: `962e8123` — FOUND in git log.

## Self-Check: PASSED
