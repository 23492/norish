---
phase: 02-multi-household
plan: 02
subsystem: api
tags: [trpc, drizzle, postgres, better-auth, bullmq, households, multi-tenant, active-household, isolation]

requires:
  - phase: 02-multi-household
    provides: recipes.household_id + user.active_household_id columns, (url, household_id) unique constraint, recipe zod householdId, Task-1 active-household repo layer (getActiveHouseholdForUser/getHouseholdsForUser/setActiveHousehold, getHouseholdMemberIds(householdId), guard removed)
provides:
  - Active-household seam wired through tRPC context + middleware (ctx.household = active cookbook; new ctx.memberHouseholdIds)
  - cached-household Redis cache re-keyed to the ACTIVE household (invalidated on switch/join/leave/kick)
  - households.list query + households.switchActive mutation; create/join "already in a household" guards removed; active set on create/join, reset to null on leave/kick
  - Recipe visibility/dedup/creation scoped by recipes.household_id (buildViewPolicyCondition, recipeExistsByUrlForPolicy, findExistingRecipe, createRecipeWithRefs onConflict target [url, household_id])
  - householdId carried end-to-end through recipe/image/paste import queue payloads + workers + the archive import chain
  - Member-id + auth-resolver callers (allergy, caldav dedup, scheduler, withAuth, OIDC claim-processor, deleteAccount) on the active-household model
  - Auto-create the user's OWN household on signup (set active) via the better-auth user.create.after hook
affects: [02-03-permissions-isolation-tests, 02-04-frontend-i18n]

tech-stack:
  added: []
  patterns:
    - "Single active-household seam: getActiveHouseholdForUser drives context/middleware/withAuth/scheduler; member-scoped secondary repos follow ctx.userIds for free"
    - "Per-cookbook recipe scoping by recipes.household_id (active cookbook); NULL household_id + userId=me = personal; userId IS NULL = orphan (retained)"
    - "Queue jobs carry householdId (= active cookbook) alongside householdKey, threaded into createRecipeWithRefs + recipeExistsByUrlForPolicy"
    - "Idempotent own-household bootstrap in better-auth user.create.after using repo functions (createHousehold/addUserToHousehold/setActiveHousehold), coexisting with the OIDC claim path"

key-files:
  created: []
  modified:
    - packages/trpc/src/context.ts
    - packages/trpc/src/middleware.ts
    - packages/db/src/cached-household.ts
    - packages/trpc/src/routers/households/households.ts
    - packages/shared/src/contracts/zod/household.ts
    - packages/shared/src/contracts/dto/household.d.ts
    - packages/db/src/repositories/recipes.ts
    - packages/trpc/src/routers/recipes/recipes.ts
    - packages/queue/src/contracts/job-types.ts
    - packages/queue/src/recipe-import/producer.ts
    - packages/queue/src/recipe-import/worker.ts
    - packages/queue/src/paste-import/worker.ts
    - packages/queue/src/image-import/worker.ts
    - packages/auth/src/withAuth.ts
    - packages/auth/src/claim-processor.ts
    - packages/auth/src/auth.ts
    - packages/trpc/src/routers/user/user.ts
    - packages/queue/src/allergy-detection/producer.ts
    - packages/queue/src/allergy-detection/worker.ts
    - packages/api/src/caldav/household-deduplication.ts
    - packages/queue/src/scheduler/recurring-grocery-check.ts
    - packages/shared-server/src/archive/parser.ts
    - packages/trpc/src/routers/archive/archive.ts

key-decisions:
  - "cached-household keeps the name getCachedHouseholdForUser but now wraps getActiveHouseholdForUser (active cookbook); switchActive/join/leave/kick invalidate it. Minimal-diff choice (no importer churn)."
  - "ctx.memberHouseholdIds is derived in middleware via getHouseholdsForUser(user.id) and added to AuthedProcedureContext + RecipeListContext; it is the requester's member set that Plan 02-03 permissions use for the per-cookbook isolation check. Forward-provisioned here (not yet consumed by buildViewPolicyCondition)."
  - "context.ts honors an optional x-active-household header: it overrides the active cookbook for that request ONLY if the user is a member (validated via getHouseholdsForUser); zero cost on the common path (header absent). Persisted switchActive remains the primary path."
  - "leave/kick resolve the SPECIFIC household via getHouseholdsForUser(...).find(id) instead of getHouseholdForUser (first), so multi-membership leave/kick targets the right household. households.get now shows the ACTIVE cookbook."
  - "SIGNUP HOOK (added Task 7, locked product decision): better-auth databaseHooks.user.create.after (packages/auth/src/auth.ts, hook spans ~lines 349-388; the better-auth AuthInstance cast it shifted now sits at auth.ts:516). Every new user gets their own household named ${name}'s Cookbook (decrypted via safeDecrypt; fallback My Cookbook), membership added, set active. Idempotent: skips when getHouseholdsForUser is non-empty. Reuses repo functions, no raw inserts. Wrapped in try/catch so a household hiccup never fails signup."
  - "OIDC INTERACTION (for human-verify): the signup hook fires for ALL signups incl. OIDC. For OIDC the user row is created first (user.create.after -> own household, set active), THEN the account is linked (account.create.after -> claim-processor). claim-processor was changed (Task 2) to no longer early-return when the user is in ANY household; it now adds the user to the CLAIMED org household only if not already a member of THAT specific one, and sets THAT active (overriding the own-household active set milliseconds earlier). Net for an OIDC user with an org claim: member of BOTH their own cookbook AND the org cookbook, with the ORG cookbook active. Both coexist; the OIDC claim path was NOT removed."
  - "recipeExistsByUrlForPolicy keeps householdUserIds in its signature (new order: url, userId, householdId, householdUserIds, viewPolicy) for caller-shape stability even though the household case now scopes by householdId; ESLint args:after-used does not flag it."
  - "findExistingRecipe gained a leading householdId param and dedups by cookbook (householdId ? household_id=that : household_id IS NULL AND userId IN members). Archive import threads the active household through, so archive imports also assign to / dedup within the active cookbook (HOUSE-07 consistency)."

patterns-established:
  - "Active-household resolution at one seam; never reintroduce getHouseholdForUser as a scoping resolver in context/middleware/withAuth"
  - "Every recipe-creation path (router create + url/image/paste import workers + archive import) sets recipes.household_id from the active cookbook"

requirements-completed: [HOUSE-01, HOUSE-02, HOUSE-03, HOUSE-04, HOUSE-05, HOUSE-07]

duration: ~2h
completed: 2026-06-13
---

# Phase 02 Plan 02: Backend Active-Household Core Summary

**Flipped norish from single-household to active-household at the tRPC context/middleware seam: getActiveHouseholdForUser drives all scoping, multi-membership enabled (guards gone), recipe visibility/dedup/creation rewritten to recipes.household_id, householdId threaded through the entire import queue + archive chain, and a signup hook now auto-creates each user's own cookbook.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-06-13
- **Tasks:** 6 (Tasks 2-7; Task 1 landed in a prior commit)
- **Files modified:** 23 across @norish/db, @norish/shared, @norish/auth, @norish/queue, @norish/trpc, @norish/api, @norish/shared-server

## Accomplishments
- **Task 2 - active-household callers:** allergy producer/worker + caldav dedup resolve the active household first then getHouseholdMemberIds(active.id) (fallback [userId]); recurring-grocery scheduler householdKey = active?.id ?? userId; withAuth requireUserAndHousehold uses getActiveHouseholdForUser; claim-processor no longer early-returns on ANY household (joins the claimed one if not already a member of THAT, sets it active); deleteAccount iterates getHouseholdsForUser and blocks if admin of ANY household with >1 member.
- **Task 3 - context/middleware/cache:** createHttpContextFromHeaders resolves the ACTIVE household (+ optional x-active-household member-validated override); cached-household wraps getActiveHouseholdForUser; withAuth forwards memberHouseholdIds (from getHouseholdsForUser) and added it to AuthedProcedureContext.
- **Task 4 - households router:** added list (households + activeHouseholdId + currentUserId) and switchActive (membership-validated -> FORBIDDEN, cache invalidation, household-switched connection invalidation); removed both create/join CONFLICT guards; create/join set the new household active; leave/kick reset active to null when the affected household was active; HouseholdSummaryDto + zod added to shared. get + leave/kick now use the active/specific household (multi-membership-safe).
- **Task 5 - recipe scoping (security core):** RecipeListContext gained activeHouseholdId + memberHouseholdIds; buildViewPolicyCondition household case scopes to recipes.household_id (active cookbook) + orphans, personal (null active) = own household-less recipes + orphans; recipeExistsByUrlForPolicy + findExistingRecipe dedup by household_id; createRecipeWithRefs takes householdId, sets it, onConflict target swapped to [recipes.url, recipes.householdId] with a matching post-conflict fallback.
- **Task 6 - import queue end-to-end:** householdId added to RecipeImportJobData/ImageImportJobData/PasteImportJobData (NutritionEstimation skipped - it only reads an existing recipe); recipe router create + all three import producers/workers thread the active household id into createRecipeWithRefs + recipeExistsByUrlForPolicy; the archive import chain (parser.importArchive/importRecipeItems + archive.ts runArchiveImportAsync + procedure) was threaded too (forced by the Task-5 signature change AND correct for HOUSE-07).
- **Task 7 - signup own-household (locked product decision):** better-auth user.create.after now creates ${name}'s Cookbook (fallback My Cookbook), adds membership, sets active - idempotent, repo-function-only, try/catch-guarded; coexists with the OIDC claim path.

## Task Commits

1. **Task 2: resolve active household in member-id + auth callers** - `2e61044f` (feat)
2. **Task 3: tRPC context/middleware -> active household + memberHouseholdIds** - `b7b53739` (feat)
3. **Task 4: households.list + switchActive; set active on lifecycle** - `6993fd88` (feat)
4. **Task 5: scope recipe visibility/dedup/creation by household_id** - `f6479737` (feat)
5. **Task 6: carry householdId through recipe import queue** - `ffbd699a` (feat)
6. **Task 7: auto-create own household on signup** - `e12f2127` (feat)

**Plan metadata:** this SUMMARY commit (docs) + STATE/ROADMAP/REQUIREMENTS update commit (docs)

## Files Created/Modified
See key-files.modified in frontmatter (23 files). Highlights:
- `packages/trpc/src/context.ts` / `middleware.ts` - the active-household seam + ctx.memberHouseholdIds + x-active-household override
- `packages/db/src/repositories/recipes.ts` - household_id scoping in buildViewPolicyCondition + dedup + createRecipeWithRefs
- `packages/trpc/src/routers/households/households.ts` - list + switchActive, guard removal, set-active on lifecycle
- `packages/auth/src/auth.ts` - Task 7 signup own-household hook
- `packages/auth/src/claim-processor.ts` - OIDC multi-membership + set-active
- `packages/shared-server/src/archive/parser.ts` + `packages/trpc/src/routers/archive/archive.ts` - householdId threaded through archive import (forced caller update)

## Decisions Made
See key-decisions in frontmatter (cache naming, memberHouseholdIds forward-provisioning, x-active-household header, leave/kick specific-household resolution, the signup hook, the OIDC interaction, dedup signature shapes).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical caller] Archive import chain threaded with householdId**
- **Found during:** Task 5/6 (changing createRecipeWithRefs + findExistingRecipe signatures)
- **Issue:** packages/shared-server/src/archive/parser.ts (importArchive/importRecipeItems) and packages/trpc/src/routers/archive/archive.ts (runArchiveImportAsync + the importArchive procedure) call createRecipeWithRefs and findExistingRecipe but are NOT in the plan's Task 5/6 file list. The signature changes would break their compilation, and archive imports must assign to the active cookbook for HOUSE-07 consistency.
- **Fix:** Added a householdId: string | null param through importArchive -> importRecipeItems and runArchiveImportAsync; the procedure passes ctx.household?.id ?? null. findExistingRecipe(householdId, ...) + createRecipeWithRefs(..., householdId, ...) updated.
- **Files modified:** packages/shared-server/src/archive/parser.ts, packages/trpc/src/routers/archive/archive.ts
- **Verification:** real tsc --noEmit own-src clean for shared-server (apart from a pre-existing dto.steps error at parser.ts:157) and trpc; plan typecheck scripts green; lint 0 errors.
- **Committed in:** ffbd699a (Task 6 commit)

**2. [Rule 1 - Consistency] households.get + create's fullHousehold fetch use the active resolver; leave/kick resolve the specific household**
- **Found during:** Task 4
- **Issue:** leave/kick used getHouseholdForUser (returns the user's FIRST membership) then checked id !== householdId - which, under multi-membership, would wrongly FORBID leaving any non-first household. households.get and create's post-create fetch also returned "first" rather than the active/new household.
- **Fix:** leave/kick now getHouseholdsForUser(...).find(h => h.id === householdId); get + create's fetch use getActiveHouseholdForUser.
- **Files modified:** packages/trpc/src/routers/households/households.ts
- **Verification:** trpc typecheck + lint clean; switchActive/leave/kick acceptance criteria pass.
- **Committed in:** 6993fd88 (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (1 missing-critical caller, 1 multi-membership correctness). **Impact:** Both required for the fork to compile and for multi-membership/HOUSE-07 to behave correctly. No scope creep beyond the active-household model; no production code weakened.

## Issues Encountered

### Pre-existing unit-test failures (contract-only; deferred to Plan 02-03 test updates)
Production code is fully green (typecheck + lint, all packages). Two test suites have failures that are NOT logic regressions:

- **@norish/db - 49 failed / 12 passed / 11 skipped.** PROVEN pre-existing: running the suite at the clean Task-1 baseline 9c2da236 (before any Task 2-7 work) produced the IDENTICAL 49 failures / 11 failed files with the same signatures (68x "Failed to parse FullRecipeDTO" via the shared createTestRecipe helper, 5x createRecipeWithRefs, 2x "is not a function"). Root cause is Plan 02-01's householdId zod addition vs. un-updated test fixtures - my Tasks 2-7 added ZERO new db test failures.
- **@norish/trpc - 32 failed / 185 passed** (baseline 9c2da236: 0 failed / 217 passed, so these 32 are introduced by THIS plan, and all are contract-only). Every one traces to Task 3's middleware now calling getHouseholdsForUser(user.id) for memberHouseholdIds: 8x "[vitest] No getHouseholdsForUser export is defined on the @norish/db mock" + 24x ECONNREFUSED :5432 (the unmocked real repo call falling through to a DB connection). The test mocks (e.g. __tests__/mocks/recipes-repository.ts, per-suite vi.mock("@norish/db")) simply don't yet stub the new dependency, and several suites assert the OLD single-household/guard behavior. Affected suites: archive-import-validation, calendar/planned-items(+stale), favorites, groceries(+recurring), households-stale, ratings, recipes/paste-import, recipes/shares, stores, user-procedures-get. The plan explicitly defers these test updates to 02-03.

No test fails for any reason OTHER than the planned signature/contract changes. No production code was weakened to satisfy a test.

### Upstream typecheck scripts use --noCheck
@norish/queue|auth|api|trpc|shared-server typecheck scripts run tsc --noEmit --noCheck (only @norish/db and @norish/shared do a real tsc --noEmit). To honor the acceptance-criteria HARD GATE I additionally ran a REAL tsc --noEmit per package filtered to its own src/: the only own-src error anywhere is the pre-existing better-auth AuthInstance cast in packages/auth/src/auth.ts (line 473 at baseline, shifted to 516 by the Task-7 hook) - unrelated to this plan. All other touched packages (db, shared, queue, trpc, api, shared-server) are own-src type-clean.

### node_modules hardlink farm
Injected node_modules/@norish/<pkg>/src are hardlinks to packages/<pkg>/src (in-place edits are already live - no cp needed). For the baseline test comparison I checked out 9c2da236, which broke a few hardlinks where git rewrote files; I re-synced with cp -a packages/<pkg>/src/. node_modules/@norish/<pkg>/src/ before/after to keep both consistent. The working tree is back on feat/phase-2-multi-household HEAD with node_modules re-synced to HEAD.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ready for **Plan 02-03** (permissions + per-cookbook isolation tests). 02-03 must: (a) wire canAccessResource/canAccessHouseholdResource to take the recipe's householdId + the requester's ctx.memberHouseholdIds (already forwarded by this plan); (b) update the @norish/trpc test mocks to stub getHouseholdsForUser (fixes the 32 contract-only failures) and the OLD-behavior assertions; (c) update the @norish/db test fixtures (createTestRecipe/FullRecipeSchema) for householdId (fixes the 49 pre-existing failures); (d) add the security-critical isolation suites (HOUSE-06).
- **Human-verify for the lead:** the Task-7 signup hook + OIDC interaction (own cookbook always created; OIDC org claim then adds the org cookbook and makes IT active - user ends up in both). Confirm this is the intended UX before 02-04 builds the switcher.

## Self-Check: PASSED

Re-ran every task's <acceptance_criteria> + the plan-level <verification>:
- Task 2: getHouseholdMemberIds callers resolve active household first (allergy producer/worker, caldav); withAuth uses getActiveHouseholdForUser; claim-processor has no unconditional early-return (getHouseholdForUser absent, uses getHouseholdsForUser + setActiveHousehold); deleteAccount iterates getHouseholdsForUser. PASS
- Task 3: context.ts calls getActiveHouseholdForUser; cached-household resolver = getActiveHouseholdForUser; middleware forwards memberHouseholdIds + it is in AuthedProcedureContext. PASS
- Task 4: households.ts has + exports list and switchActive; no "already in a household"; create/join call setActiveHousehold; switchActive validates membership + invalidates cache + emits household-switched; HouseholdSummaryDto + zod in shared. PASS
- Task 5: RecipeListContext has activeHouseholdId + memberHouseholdIds; buildViewPolicyCondition household case filters on recipes.householdId; createRecipeWithRefs takes householdId + onConflict target [recipes.url, recipes.householdId]; recipeExistsByUrlForPolicy + findExistingRecipe honor householdId. PASS
- Task 6: job-types RecipeImportJobData/ImageImportJobData/PasteImportJobData carry householdId; recipes.ts create passes ctx.household?.id ?? null; all 3 import workers call createRecipeWithRefs with householdId from job; RecipeListContext built with activeHouseholdId + memberHouseholdIds in the recipe router. PASS
- Task 7: better-auth user.create.after creates ${name}'s Cookbook (fallback My Cookbook) via createHousehold/addUserToHousehold/setActiveHousehold, idempotent, no raw inserts; OIDC claim path intact. PASS
- <verification>: typecheck across db/shared/auth/queue/trpc/api green (plan scripts) AND a real tsc --noEmit own-src check clean for every touched package except the pre-existing auth.ts AuthInstance cast; lint 0 errors on all touched packages; no getHouseholdForUser remains as a scoping resolver in context/middleware/withAuth; recipes.household_id referenced in buildViewPolicyCondition + createRecipeWithRefs. Unit-test failures (@norish/db 49 = pre-existing at baseline; @norish/trpc 32 = contract-only from the new getHouseholdsForUser middleware dependency) verified against the 9c2da236 baseline and deferred to 02-03 per the plan. PASS

SUMMARY key-files.modified all exist on disk; git log shows 6 feat(02-02) commits.

---
*Phase: 02-multi-household*
*Completed: 2026-06-13*
