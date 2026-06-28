---
phase: "20"
plan: "01"
subsystem: "db-schema-merge"
tags: ["merge", "upstream", "db-schema", "security", "HOUSE-06"]
requires: []
provides: ["upstream-0.19.0-base", "db-schema-subsystem"]
affects: ["packages/db", "packages/db-schema", "packages/auth", "packages/trpc", "packages/api", "packages/shared"]
tech-stack:
  added: ["@norish/db-schema (workspace:* package split)"]
  patterns: ["per-cookbook recipe isolation (HOUSE-06)", "AnyPgColumn mutual FK pattern"]
key-files:
  created:
    - packages/db-schema/src/schema/households.ts
    - packages/db-schema/src/schema/recipes.ts
    - packages/db-schema/src/schema/auth.ts
    - packages/db-schema/src/schema/relations.ts
    - packages/db-schema/src/schema/recipe-ratings.ts
    - packages/db-schema/src/schema/recipe-shares.ts
    - packages/db-schema/src/schema/household-users.ts
    - packages/db-schema/src/schema/site-auth-tokens.ts
  modified:
    - packages/db/src/repositories/households.ts
    - packages/db/src/repositories/recipes.ts
    - packages/db/src/repositories/ratings.ts
    - packages/db/src/repositories/users.ts
    - packages/trpc/src/middleware.ts
    - packages/trpc/src/routers/recipes/helpers.ts
    - packages/trpc/src/routers/recipes/recipes.ts
    - packages/auth/src/auth.ts
    - packages/shared/src/contracts/zod/household.ts
    - packages/shared-server/src/ai/utils/category-matcher.ts
    - packages/shared-server/src/archive/parser.ts
decisions:
  - "Strategy B (take upstream) for all non-constraint conflicts except fork-critical files"
  - "Per-table 3-way re-apply (D-04/D-05) for db-schema: upstream base + fork column additions only"
  - "Added getUserHouseholdIds + memberHouseholdIds to trpc middleware for 8-arg canAccessResource"
  - "12 pre-existing infrastructure test failures (timer-keywords/cleanup-workflows ECONNREFUSED) documented; isolation suite 6/6 green"
metrics:
  duration: "~90 minutes active (multi-context session)"
  completed: "2026-06-28"
  tasks_completed: 1
  files_changed: ~994
---

# Phase 20 Plan 01: Upstream 0.19.0 Merge + DB-Schema Subsystem Summary

**One-liner:** Single merge commit of upstream/main@1f684480 (v0.19.0-beta) with per-table 3-way db-schema re-apply, Camoufox constraint assertion, and HOUSE-06 per-cookbook isolation boundary verified adversarially.

## What Was Built

Merged `upstream/main` at `1f68448021dc2adbca83d5d10b25ebf04e04ac8d` (`Rc/0.19.0`) into `integ/upstream-0.19.0`. The merge commit `421c1214` has:
- Parent 1: `33bc77e9` (fork tip)
- Parent 2: `1f684480` (upstream/main - verified via `git rev-parse HEAD^2`)

### Key Changes

**Camoufox Constraint (Hard Rule)**
- Deleted `packages/api/src/playwright.ts` (confirmed absent)
- Restored Camoufox-native path in `packages/api/src/parser/fetch.ts`

**@norish/db-schema Package Split (D-04/D-05)**
- `packages/db-schema/` materialized with upstream's full schema definitions
- Fork additions added back via 3-way re-apply:
  - `households.ts`: `permissionLevel` pgEnum, `inviteToken`, `viewPolicy/editPolicy/deletePolicy` columns
  - `recipes.ts`: `householdId` FK, `recipeVisibilityEnum`, `visibility` column, `uq_recipes_url_household` unique
  - `auth.ts`: `activeHouseholdId` column with `AnyPgColumn` mutual FK
  - `relations.ts`: household relations on recipes, householdUsers/households

**Fork-Critical Files Restored (Strategy B incorrectly stripped these)**
- `packages/db/src/repositories/households.ts`: Full fork implementation (~820 lines) with `getHouseholdsForUser`, `setActiveHousehold`, `generateInviteToken`, `getHouseholdPolicy`, `setHouseholdPolicy`, etc.
- `packages/db/src/repositories/recipes.ts`: `RecipeListContext` with `activeHouseholdId` + `memberHouseholdIds`, `buildViewPolicyCondition` with HOUSE-06 boundary
- `packages/db/src/repositories/ratings.ts`: `removeUserRating`, `getRecipeRaters`
- `packages/db/src/repositories/users.ts`: `setUserServerRole`, `getActiveHouseholdId`, `setActiveHouseholdId`
- `packages/trpc/src/routers/recipes/helpers.ts`: 8-arg `canAccessResource` with `resolveRecipeCookbookPolicy`
- `packages/shared/src/contracts/zod/household.ts`: `HouseholdWithUsersNamesSchema.omit({inviteToken, viewPolicy, editPolicy, deletePolicy})`

**trpc Middleware Enhancement**
- Added `getUserHouseholdIds` to `packages/db/src/repositories/households.ts`
- Updated `withAuth` middleware to fetch `memberHouseholdIds` (all household IDs user belongs to)
- Updated `AuthedProcedureContext` to include `memberHouseholdIds: string[]`
- Updated all 3 `RecipeListContext` constructions in `recipes.ts` to pass `activeHouseholdId` + `memberHouseholdIds`
- Added `householdId` to `RecipeImportJobData`, `ImageImportJobData`, `PasteImportJobData` call sites

## Verification Gates

### DB Typecheck
```
pnpm --filter @norish/db exec tsc -p tsconfig.json --noEmit
```
Result: **CLEAN** (zero errors)

### trpc Typecheck
```
pnpm --filter @norish/trpc exec tsc -p tsconfig.json --noEmit
```
Result: **CLEAN** (zero errors)

### DB Test Suite
```
sg docker -c 'pnpm --filter @norish/db test'
```
Result: **90 passed, 12 failed (102 total)**

The 12 failures are pre-existing infrastructure issues:
- 9 `timer-keywords-config.test.ts`: ECONNREFUSED to `::1:5432` (static pool initialized with `localhost:5432` default, not the dynamic Docker test port). Same failure mode exists upstream.
- 3 `cleanup-workflows.test.ts`: ECONNREFUSED - cleanup functions from `@norish/api`/`@norish/queue` connect via static pool not reset to test DB.

These are NOT caused by our changes (test files unchanged since v0.17.0).

### Isolation Suite (Security-Critical HOUSE-06)
```
sg docker -c 'pnpm --filter @norish/db exec vitest run --config vitest.config.ts "__tests__/server/db/repositories/households.isolation.test.ts"'
```
Result: **6/6 PASSED**

### Adversarial Isolation Check (CLAUDE.md security requirement)
1. Weakened `buildViewPolicyCondition` (removed HOUSE-06 boundary for active cookbook)
2. Ran isolation suite → **3/6 FAIL** (cross-cookbook leak confirmed)
3. Reverted byte-identical
4. Ran isolation suite → **6/6 PASS**
5. `git diff` clean (weakening NOT committed)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Strategy B misapplied to fork-critical files**
- Found during: Task execution
- Issue: Strategy B (`git checkout --theirs`) was applied to `zod/household.ts`, `repositories/households.ts`, `repositories/recipes.ts`, `repositories/ratings.ts`, `trpc/routers/recipes/helpers.ts`, which stripped 400-800 lines of fork additions from each
- Fix: Rewrote each file as 3-way hybrid (upstream base + fork additions re-applied)
- Files: All listed under "Fork-Critical Files Restored" above

**2. [Rule 1 - Bug] connection-manager.ts INVALIDATION_CHANNEL typo**
- Found during: trpc typecheck
- Issue: Line 130 used bare `INVALIDATION_CHANNEL` but import was `CONNECTION_INVALIDATION_CHANNEL`
- Fix: Corrected the unsubscribe call
- Files: `packages/trpc/src/connection-manager.ts`

**3. [Rule 1 - Bug] pending.ts BullMQ dual-version type conflict**
- Found during: trpc typecheck
- Issue: `@norish/queue` has nested `bullmq@5.71.1` while root has `5.76.8`; explicit `Job<T>` type annotations in callbacks caused incompatibility
- Fix: Removed explicit type annotations, let TypeScript infer from array element type
- Files: `packages/trpc/src/routers/recipes/pending.ts`

**4. [Rule 1 - Bug] category-matcher.ts noUncheckedIndexedAccess**
- Found during: trpc typecheck (shared-server files included transitively)
- Issue: `results[0]` typed as `T | undefined` despite `results.length === 0` guard; `noUncheckedIndexedAccess: true` in base tsconfig
- Fix: Added `!` non-null assertion with explanatory comment
- Files: `packages/shared-server/src/ai/utils/category-matcher.ts`

**5. [Rule 1 - Bug] parser.ts `dto.steps` possibly undefined**
- Found during: trpc typecheck
- Issue: `dto.steps.map(...)` where `steps` can be `undefined`
- Fix: Changed to `(dto.steps ?? []).map(...)`
- Files: `packages/shared-server/src/archive/parser.ts`

**6. [Rule 1 - Bug] auth.ts better-auth 1.6.9 type incompatibility**
- Found during: auth typecheck
- Issue: `createBetterAuth() as AuthInstance` failed with better-auth 1.6.9's updated user type requiring fork's custom fields (isServerOwner, isServerAdmin, emailHmac)
- Fix: Changed to `createBetterAuth() as unknown as AuthInstance`
- Files: `packages/auth/src/auth.ts`

**7. [Rule 2 - Missing Critical] getUserHouseholdIds and memberHouseholdIds**
- Found during: implementing assertRecipeAccess with 8-arg canAccessResource
- Issue: `RecipeUserContext` needed `memberHouseholdIds: string[]` (all household IDs user belongs to) for per-cookbook policy checks, but no function existed to fetch them
- Fix: Added `getUserHouseholdIds` to households repo, added `memberHouseholdIds` to withAuth middleware and AuthedProcedureContext
- Files: `packages/db/src/repositories/households.ts`, `packages/trpc/src/middleware.ts`

**8. [Rule 1 - Bug] job data householdId missing in trpc callers**
- Found during: trpc typecheck
- Issue: Upstream 0.19.0 added `householdId: string | null` to `RecipeImportJobData`, `ImageImportJobData`, `PasteImportJobData` but trpc callers didn't pass it
- Fix: Added `householdId: ctx.household?.id ?? null` to all 3 job creation calls
- Files: `packages/trpc/src/routers/recipes/recipes.ts`

**9. [Rule 1 - Bug] ingredient-unit-normalization test missing householdId arg**
- Found during: db test run
- Issue: Test called `createRecipeWithRefs(recipeId, testUserId, {...})` with 3 args but function now takes 4 (householdId as 3rd param)
- Fix: Updated to `createRecipeWithRefs(recipeId, testUserId, null, {...})`
- Files: `packages/db/__tests__/server/db/repositories/ingredient-unit-normalization.test.ts`

### Known Pre-existing Failures (Not Fixed)

**12 infrastructure-level test failures** in `timer-keywords-config.test.ts` (9) and `cleanup-workflows.test.ts` (3):
- Root cause: `@norish/api` and `@norish/queue` functions called in tests use the `db` singleton initialized with `localhost:5432` (from vitest.config.ts `env.DATABASE_URL`) before `testBase.setup()` can redirect it to the dynamic Docker test port
- These test files are unchanged since v0.17.0 and the failures appear to be a pre-existing issue with the test infrastructure
- NOT caused by our schema changes

## Files Pending Re-assertion

The following fork deltas were temporarily dropped via Strategy B and will be re-asserted by downstream plans:

### Plan 20-02 (api package)
- `packages/api/src/parser/fetch.ts` fork additions beyond Camoufox base
- All api recipe processing with household scoping

### Plan 20-03 (trpc/shared-react/shared/shared-server)
- trpc household router fork additions
- shared-react household context components
- shared zod schemas for household/recipe visibility

### Plan 20-04 (web)
- Web app household/cookbook UI components
- Recipe visibility UI

### Plan 20-05 (queue/CI)
- Queue job types with householdId handling
- CI workflow fork customizations

## Merge Commit

**Commit:** `421c1214`
**Branch:** `integ/upstream-0.19.0`
**Parents:**
- `33bc77e9` (fork tip: "docs(20): reconcile merge-commit model to Strategy B")
- `1f684480` (upstream/main: "Rc/0.19.0")

Verification: `git rev-parse HEAD^2 == 1f68448021dc2adbca83d5d10b25ebf04e04ac8d` ✓

## Known Stubs

None - no placeholder data wired to UI rendering in the db-schema subsystem.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-auth-endpoint | packages/auth/src/auth.ts | better-auth 1.6.9 may expose new API endpoints; fork's custom user fields (isServerAdmin/isServerOwner) are validated at login |
| threat_flag: household-scoping | packages/db/src/repositories/recipes.ts | HOUSE-06 boundary in buildViewPolicyCondition is security-critical; adversarially verified RED→GREEN |

## Self-Check

- [x] Merge commit exists: `421c1214`
- [x] `git rev-parse HEAD^2` = `1f684480` (upstream/main)
- [x] Zero conflict markers: `git grep -l "^<<<<<<" --cached` = empty
- [x] DB typecheck: clean
- [x] Isolation suite: 6/6 passed
- [x] Adversarial check: weakened→RED, reverted→GREEN
- [x] Weakened file not committed: `git diff` clean after revert

## Self-Check: PASSED
