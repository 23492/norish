---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 11
  completed_plans: 8
  percent: 73
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12)

**Core value:** Reliable recipe import & management for Kiran's groups, incl. bot-protected sources, with no extra setup vs upstream.
**Current focus:** Phase 2 — Multi-household cookbooks (executing; wave 3 of 4 complete)

## Current Position

Phase: 2 of 3 (Multi-household cookbooks)
Plan: Executing — 02-03 of 4 complete; next is 02-04 (frontend + i18n, has a human-verify checkpoint)
Status: In Progress
Last activity: 2026-06-13 — 02-03 (permissions + per-cookbook isolation tests, SECURITY-CRITICAL, HOUSE-06) shipped: canAccessResource is now cookbook-aware (resourceHouseholdId + requesterMemberHouseholdIds; household level = requester must be a member of the recipe's own cookbook; NULL household = owner-only); recipe helpers + the convert mutation pass the recipe's householdId + ctx.memberHouseholdIds; added getRecipeOwnerAndHousehold; getRecipeFull/dashboardRecipe/listRecipes now select+map householdId (the real cause of the 49 db failures — a 02-01 prod omission). Two dedicated isolation suites prove HOUSE-06 at the DB-scoping layer (households.isolation.test.ts, 6 tests) and the tRPC permission layer (permissions-integration.test.ts rewritten to a REAL-boundary test, 16 tests incl. a cross-cookbook block). Adversarial sanity check performed on BOTH layers (weaken canAccessResource → tRPC RED; weaken buildViewPolicyCondition → DB RED; reverted → both GREEN; weakenings never committed). Also fixed a latent per-cookbook dedup bug (recipeExistsByUrlForPolicy used `!== null` vs drizzle's undefined → exists always true). Cleared all 49 db + 32 trpc + 4 auth contract failures 02-02 deferred. Final: @norish/auth 61/61, @norish/trpc 223/223 green; @norish/db all cookbook/contract failures gone (3 pre-existing updateRecipeWithRefs unit-normalization failures remain — out of scope, follow-up task spawned). typecheck+lint clean across auth/db/trpc/shared. HOUSE-06 complete.

Progress: [███████░░░] 73%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table + Phase 2 CONTEXT.md (D-01..D-15). Recent:

- Phase 0: Dev + build on LXC 110 via SSH; fork under gh account 23492; gsd-core minimal profile. (done)
- Phase 1: native Camoufox REST client replaced chromium.connectOverCDP; vendored camofox-browser v1.4.1 bundled by default; CAMOFOX_URL config; cloud keys via admin UI not env. (done)
- Phase 2 (planned): `recipes.household_id` (nullable, ON DELETE SET NULL; NULL=personal) scopes recipe visibility; `user.active_household_id` is the active-cookbook pointer; unique constraint swaps `(url,userId)`→`(url,household_id)`.
- Phase 2 (planned): `getHouseholdForUser` → `getActiveHouseholdForUser` is THE central seam — member-scoped secondary repos (groceries/calendar/allergies/caldav) follow the active cookbook for free via `ctx.userIds`.
- Phase 2 (planned): per-cookbook isolation enforced in `permissions.ts` (`canAccessResource` takes recipe household_id + requester member household ids); dedicated DB + tRPC isolation tests (security-critical, HOUSE-06).
- Phase 2 (planned): `recipe_permission_policy` shape unchanged; `household` level reinterpreted as "recipe's own cookbook + requester is a member"; per-cookbook policy override deferred to v2 (HOUSE-08).
- Phase 2 (planned): i18n gate `i18n:check` requires new keys in ALL 11 locales (not just nl+en).
- Phase 2 (02-01 done): schema primitives + migration 0035 landed; activeHouseholdId FK callback annotated with `AnyPgColumn` (drizzle-orm/pg-core) to break the user↔households mutual-reference type cycle. (done)
- Phase 2 (02-02 done): active-household seam wired (context/middleware/withAuth/scheduler use getActiveHouseholdForUser; cached-household re-keyed to active; ctx.memberHouseholdIds added for 02-03 isolation); multi-membership (guards gone, households.list + switchActive, active set on create/join, reset on leave/kick); recipe scoping by recipes.household_id (buildViewPolicyCondition + dedup + createRecipeWithRefs onConflict [url, household_id]); import queue + archive carry householdId; signup auto-creates the user's own cookbook (better-auth user.create.after) which coexists with the OIDC claim path (OIDC org claim then sets the org cookbook active). (done)
- Phase 2 (02-03 done): per-cookbook isolation enforced server-side in TWO layers — canAccessResource(action,userId,ownerId,resourceHouseholdId,requesterMemberHouseholdIds,isServerAdmin) for item access (household level = member-of-the-recipe's-cookbook; NULL household = owner-only) AND buildViewPolicyCondition for list scoping. canAccessHouseholdResource kept unchanged (groceries/calendar/stores items lack household_id; member-overlap is correct). Dedicated DB + tRPC isolation suites, adversarially verified RED-when-weakened on both layers. Found+fixed a latent dedup bug (recipeExistsByUrlForPolicy `!== null` vs drizzle undefined). getRecipeFull/dashboardRecipe/listRecipes select+map householdId (fixed the deferred 49 db failures, a 02-01 prod omission). HOUSE-06 complete. (done)

### Pending Todos

- Execute Plan 02-04 (frontend + i18n): cookbook switcher (navbar + mobile, +Personal option), list/active/switch hooks + context, assign-to-active-cookbook import UX; i18n keys in ALL 11 locales (i18n:check gate). Has a human-verify checkpoint (confirm the signup own-cookbook + OIDC interaction UX from 02-02 before/with the switcher).
- Follow-up (non-blocking, spawned task): fix syncRecipeIngredientsTx unit normalization — 3 pre-existing @norish/db updateRecipeWithRefs tests (create path normalizes units, update path does not; predates Phase 2).
- Phase 3 (AssemblyAI) remains unplanned; independent of Phase 2.
