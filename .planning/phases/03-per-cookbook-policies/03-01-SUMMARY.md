---
phase: 03-per-cookbook-policies
plan: 01
subsystem: auth
tags: [permissions, drizzle, postgres, trpc, zod, react, i18n, pgenum, multi-household]

requires:
  - phase: 02-multi-household
    provides: recipes.household_id cookbook scoping, canAccessResource(resourceHouseholdId, requesterMemberHouseholdIds), buildViewPolicyCondition active-cookbook scoping, households.adminUserId single-admin model, HOUSE-06 isolation suites
provides:
  - Per-cookbook view/edit/delete policy columns on households (permission_level pgEnum) + migration 0037 with backfill
  - canAccessResource resolved per-cookbook (recipe's own household) with admin-edits-any / members-edit-own for edit/delete=household
  - buildViewPolicyCondition source-swapped to the active cookbook's view_policy (active cookbook never widens cross-cookbook)
  - getHouseholdPolicy + setHouseholdPolicy repo fns (admin-only, optimistic version, rejects view=everyone) + seed-on-create
  - households.setPolicy admin mutation + SetHouseholdPolicyInputSchema (view in household|owner) + admin-gated policy in the settings DTO
  - Admin-only per-cookbook Recipe Permissions card + i18n (11 locales)
affects: [SHARE-01, move-recipe-between-cookbooks, future per-recipe ACLs]

tech-stack:
  added: []
  patterns:
    - "Pass a resolved cookbook policy + admin id into the sync canAccessResource (parallels 02-03 pushing householdId/memberHouseholdIds into the signature)"
    - "Per-cookbook policy stored as first-class enum columns on households (permission_level pgEnum reused from PermissionLevelSchema)"
    - "Admin-only fields (inviteToken, policy) fetched admin-gated in resolveHouseholdDto + omitted from the member resolver DTO"

key-files:
  created:
    - packages/db/src/migrations/0037_curious_bloodscream.sql
    - apps/web/app/(app)/settings/household/components/permission-policy-card.tsx
    - packages/db/__tests__/server/db/repositories/households.policy.test.ts
    - packages/auth/__tests__/resolve-cookbook-policy.test.ts
  modified:
    - packages/db/src/schema/households.ts
    - packages/auth/src/permissions.ts
    - packages/db/src/repositories/households.ts
    - packages/db/src/repositories/recipes.ts
    - packages/shared/src/contracts/zod/household.ts
    - packages/trpc/src/routers/households/households.ts
    - packages/trpc/src/routers/recipes/helpers.ts
    - packages/trpc/src/routers/recipes/recipes.ts
    - packages/shared-react/src/hooks/households/use-household-mutations.ts
    - packages/shared-react/src/contexts/households/household-context.tsx

key-decisions:
  - "Storage: 3 permission_level enum columns on households (view/edit/delete), defaulting to DEFAULT_RECIPE_PERMISSION_POLICY; server-wide policy demoted to default-for-new-cookbooks + personal-recipe fallback"
  - "edit/delete=household => recipe owner OR cookbook admin (admin-edits-any/members-edit-own); no new role system"
  - "DISALLOW per-cookbook view=everyone (view in household|owner); active-cookbook list never widens cross-cookbook (HOUSE-06)"
  - "canAccessResource made sync; callers resolve the recipe-cookbook policy+admin via resolveRecipeCookbookPolicy and pass them in"
  - "Emit-scope readers (~12 emitByPolicy sites) kept on the global default (broadcast scope only, not a security gate) — documented; the gate readers (canAccessResource) go per-cookbook"

patterns-established:
  - "resolveRecipeCookbookPolicy(resourceHouseholdId): keys policy+admin off the recipe's OWN cookbook, global-default fallback for personal/missing"
  - "Adversarial weaken->RED->revert at BOTH seams (admin check; view-policy source)"

requirements-completed: [POLICY-01]

duration: 2h 5m
completed: 2026-06-14
---

# Phase 3 Plan 01: Per-cookbook permission policies (POLICY-01) Summary

**Each cookbook now carries its own view/edit/delete policy (permission_level enum columns + migration 0037), the access gate resolves per-cookbook with admin-edits-any/members-edit-own, and an admin-only Recipe Permissions card sets it — HOUSE-06 isolation preserved under every policy combo.**

## Performance

- **Duration:** 2h 5m
- **Started:** 2026-06-14T00:55:00Z
- **Completed:** 2026-06-14T03:00:00Z
- **Tasks:** 4 (schema/migration; core permission logic; tests/adversarial; UI/i18n)
- **Files modified:** 34 (incl. the generated 0037 snapshot)

## Accomplishments
- Per-cookbook `view_policy`/`edit_policy`/`delete_policy` enum columns on `households` (new `permission_level` pgEnum reusing the config `PermissionLevelSchema` values) + migration `0037_curious_bloodscream.sql` adding the enum/columns and backfilling existing households from the current server-wide `recipe_permission_policy` (no-op on this instance: 0 households).
- `canAccessResource` resolves the policy + admin from the RECIPE'S OWN cookbook (`resolveRecipeCookbookPolicy(resourceHouseholdId)`) instead of the global config; `edit`/`delete = household` now means owner OR cookbook admin (admin-edits-any / members-edit-own).
- `buildViewPolicyCondition` reads the ACTIVE cookbook's `view_policy`; an active cookbook is hard-scoped and NEVER widens cross-cookbook (HOUSE-06), even when a seeded policy is `everyone`.
- `getHouseholdPolicy` + `setHouseholdPolicy` (admin-only, optimistic version, rejects `view=everyone`) + policy seeded on household create; `households.setPolicy` admin mutation with cache invalidation + a `policyUpdated` emit; admin-gated policy surfaced in the settings DTO.
- Admin-only "Recipe Permissions" card on the Household settings page (mirrors the server-admin card), wired through the settings context/`setPolicy` hook; `view` Select offers only Household/Owner (decision #5). i18n in all 11 locales (nl+en real, 9 EN-fallback).

## Task Commits

1. **Task 1: schema + migration** - `4197e164` (feat) — permission_level pgEnum + 3 columns + migration 0037 + backfill
2. **Task 2: core permission logic** - `efd9e486` (feat) — per-cookbook resolution + admin-or-owner + repo/router/DTO
3. **Task 3: tests + adversarial** - `dfcafed3` (test) — admin-vs-member + 27-combo isolation grid + real-parse; migration cast fix folded in
4. **Task 4: UI + i18n** - `e4d87bb2` (feat) — per-household Recipe Permissions card + setPolicy wiring + 11-locale i18n

## Decisions Made
Followed the 7 locked decisions exactly. One scope clarification: the ~12 `emitByPolicy` realtime-broadcast-scope readers (ratings/shares/pending/recipes/households L607) were LEFT on the global default — they decide websocket fan-out, not access (the access gate is `canAccessResource`/`buildViewPolicyCondition`, both per-cookbook). The CONTEXT Design §D flagged this as acceptable with a documented caveat; widening emit scope is not a security concern (a mis-scoped emit only triggers a refetch that is then correctly filtered). Decision #7's "single source for cookbook recipes" is satisfied at the gate readers.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] migration-0037 backfill COALESCE enum cast**
- **Found during:** Task 3 (running the real-Postgres test infra, which applies all migrations at boot)
- **Issue:** `COALESCE(value->>'view' /*text*/, view_policy /*permission_level*/)::permission_level` failed with "COALESCE types text and permission_level cannot be matched"
- **Fix:** cast the text extraction to the enum INSIDE the COALESCE: `COALESCE((SELECT value->>'view' ...)::permission_level, view_policy)`
- **Files modified:** packages/db/src/migrations/0037_curious_bloodscream.sql
- **Verification:** real-PG test infra applies 0037 cleanly; households.isolation 6/6 + households.policy 9/9 green
- **Committed in:** dfcafed3 (Task 3 commit)

**2. [Rule 1 - Bug] households-stale + web hook test mocks missing the new mutations**
- **Found during:** Task 3 (trpc) + Task 4 (web)
- **Issue:** resolveHouseholdDto now calls getHouseholdPolicy; the shared-react factory now calls trpc.households.setPolicy — pre-existing test mocks lacked these, crashing those suites
- **Fix:** added getHouseholdPolicy to the households-stale @norish/db mock; added setPolicy to the web test-utils + use-household-mutations tRPC mocks (+ a versioned-input assertion)
- **Files modified:** packages/trpc/__tests__/households/households-stale.test.ts, apps/web/__tests__/hooks/households/{test-utils.tsx, use-household-mutations.test.ts}
- **Verification:** households-stale 9/9, web household hooks 26/26 green
- **Committed in:** dfcafed3 + e4d87bb2

**3. [Rule 3 - Blocker] re-synced 4 stale node_modules hardlink twins**
- **Found during:** Task 2 (strict tsc read stale node_modules/@norish/* copies)
- **Issue:** 4 injected-workspace twins (db households/recipes repos, shared zod household, trpc households router) were de-linked from an earlier checkout (a known 02-05/02-06 deviation), so the build saw stale code (e.g. missing SetHouseholdPolicyInputSchema export)
- **Fix:** rm + cp the edited files to their node_modules twins (per CLAUDE.md re-sync guidance)
- **Files modified:** node_modules twins only (not committed)
- **Verification:** strict tsc + all suites green afterward
- **Committed in:** n/a (node_modules, not tracked)

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocker). **Impact:** all necessary for correctness; no scope creep.

## Issues Encountered
None beyond the deviations above.

## Adversarial Verification (security-critical, HOUSE-06)
Weaken -> RED -> revert at BOTH seams (weakenings never committed; reverts confirmed byte-identical to the committed state via empty `git diff`):
- **Seam 1 (canAccessResource):** dropped the admin-or-owner check (edit/delete=household allows any member) -> auth `permissions.test` "a non-admin MEMBER cannot edit/delete another member's recipe" went RED (2 tests); the 27-combo cross-cookbook isolation grid stayed GREEN (correct — separate concern). Reverted -> 49/49 GREEN.
- **Seam 2 (buildViewPolicyCondition):** read the GLOBAL view policy instead of the active cookbook's column -> db `households.policy` "view=owner source-swap proof" went RED (member saw the admin's recipe via the global default). Reverted -> 9/9 GREEN.

## Real-Postgres Parse Test (02-06 lesson)
`packages/db/__tests__/.../households.policy.test.ts` runs against a real Postgres testcontainer (applies migration 0037 at boot): asserts a created household row parses through `HouseholdSelectBaseSchema` WITH the new enum columns, and that `getHouseholdById` (SELECT * + safeParse) returns non-null — proving the real row matches the createSelectSchema-derived zod. The source-swap is also proven here (cookbook view=owner -> member sees only their own recipe).

## Static Verify (all GREEN)
- typecheck: db, shared, auth, trpc, shared-react, web — all clean
- i18n:check: exit 0 (all 11 locales complete)
- lint: auth/trpc/shared-react/web 0 problems; db/shared only pre-existing warnings (0 errors), none in touched files
- tests: auth 99/99; trpc households+permissions+recipes 88/88 (7 files); db household suites 18/18 (isolation 6 + policy 9 + invite-token-resolver 3, real PG); web household hooks 26/26

## Human-Verify: PENDING (lead — Chrome)
Lead to rebuild norish:local + recreate the norishp2 verify stack (applies migration 0037 at boot) and verify in Chrome:
- Settings -> Household (as the cookbook admin): the Recipe Permissions card shows the cookbook's view/edit/delete; the View Select offers ONLY Household/Owner (no Everyone).
- Set edit=Household -> a non-admin member cannot edit another member's recipe; the admin can; the owner can (members-edit-own).
- Set view=Owner -> a member sees only their own recipes in that cookbook; switching cookbooks still isolates (HOUSE-06).
- A non-admin member does NOT see the policy card.
- migration 0037 applies at boot (enum + 3 columns; backfill no-op at 0 households).

## Self-Check: PASSED
- key-files.created exist on disk (0037 sql, permission-policy-card.tsx, households.policy.test.ts, resolve-cookbook-policy.test.ts).
- 4 `(03-01)` commits present on feat/phase-2-multi-household (4197e164, efd9e486, dfcafed3, e4d87bb2); nothing pushed.
- All acceptance criteria re-run GREEN (typecheck/lint/i18n/tests above); adversarial weaken->red->revert proven at both seams; real-parse green.
- Live containers (norish-app/db/redis) untouched; no docker/dev build run.

---
*Phase: 03-per-cookbook-policies*
*Completed: 2026-06-14*
