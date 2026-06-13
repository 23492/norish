---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 11
  completed_plans: 9
  percent: 82
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12)

**Core value:** Reliable recipe import & management for Kiran's groups, incl. bot-protected sources, with no extra setup vs upstream.
**Current focus:** Phase 2 — Multi-household cookbooks (all 4 plans code-complete; human-verify of 02-04 pending with the lead)

## Current Position

Phase: 2 of 3 (Multi-household cookbooks)
Plan: 02-04 of 4 CODE-COMPLETE (frontend cookbook switcher + assign-to-cookbook UX + i18n). All 4 plans have SUMMARYs. The 02-04 human-verify checkpoint (docker build + visual smoke) is OWNED BY THE LEAD and still PENDING.
Status: In Progress (code-complete; human-verify pending)
Last activity: 2026-06-13 — 02-04 (frontend cookbook switcher + assign-to-cookbook UX + i18n) CODE-COMPLETE: extended shared-react household hooks (useHouseholdsListQuery -> households.list; switchActive mutation that invalidates the household-list AND recipes.list query path) + the household context (households/activeHouseholdId/switchActive); a Cookbook DropdownSection in the shared NavbarUserMenu (rendered by desktop navbar + mobile bottom-bar) lists every household + a Personal option, marks the active one, calls switchActive — fully localized; the import-from-URL modal indicates the active-cookbook assign target; recipes-context refetches the list on activeHouseholdId change (server-event safety net beyond the local switchActive). i18n: navbar.cookbook.* (6 keys) + common.import.url.targetCookbook added to ALL 11 locales — nl+en REAL, the other 9 use the EN string value (user-locked EN-fallback) — pnpm i18n:check exits 0. Create/join uses the EXISTING join-by-code flow (entry -> /settings?tab=household); NO invite-link system built (out of scope). Static verification GREEN: shared-react typecheck, web typecheck, i18n:check, web lint all exit 0 (real tsc filtered to all touched shared-react files = 0 errors). 5 feat(02-04) commits on feat/phase-2-multi-household; nothing pushed; live DB/containers untouched; no docker/dev-server build run. HUMAN-VERIFY (docker build + visual smoke + the signup own-cookbook/OIDC UX confirmation) is PENDING with the LEAD.

Previous activity: 2026-06-13 — 02-03 (permissions + per-cookbook isolation tests, SECURITY-CRITICAL, HOUSE-06) shipped: canAccessResource is now cookbook-aware (resourceHouseholdId + requesterMemberHouseholdIds; household level = requester must be a member of the recipe's own cookbook; NULL household = owner-only); recipe helpers + the convert mutation pass the recipe's householdId + ctx.memberHouseholdIds; added getRecipeOwnerAndHousehold; getRecipeFull/dashboardRecipe/listRecipes now select+map householdId (the real cause of the 49 db failures — a 02-01 prod omission). Two dedicated isolation suites prove HOUSE-06 at the DB-scoping layer (households.isolation.test.ts, 6 tests) and the tRPC permission layer (permissions-integration.test.ts rewritten to a REAL-boundary test, 16 tests incl. a cross-cookbook block). Adversarial sanity check performed on BOTH layers (weaken canAccessResource → tRPC RED; weaken buildViewPolicyCondition → DB RED; reverted → both GREEN; weakenings never committed). Also fixed a latent per-cookbook dedup bug (recipeExistsByUrlForPolicy used `!== null` vs drizzle's undefined → exists always true). Cleared all 49 db + 32 trpc + 4 auth contract failures 02-02 deferred. Final: @norish/auth 61/61, @norish/trpc 223/223 green; @norish/db all cookbook/contract failures gone (3 pre-existing updateRecipeWithRefs unit-normalization failures remain — out of scope, follow-up task spawned). typecheck+lint clean across auth/db/trpc/shared. HOUSE-06 complete.

Progress: [████████░░] 82%

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
- Phase 2 (02-04 code-complete): frontend cookbook switcher built on the shared-react factory — useHouseholdsListQuery (households.list) + a switchActive mutation that invalidates the household-list AND recipes.list query path; HouseholdContextValue gained households/activeHouseholdId/switchActive. One shared Cookbook DropdownSection in NavbarUserMenu serves desktop navbar + mobile bottom-bar (lists households + a Personal option, checks the active one, onPress->switchActive); mobile-nav also shows the active cookbook name. Import modal indicates the active-cookbook target (no v1 picker; backend assigns to active). recipes-context refetches on activeHouseholdId change too. i18n: nl+en real, other 9 EN-fallback (user-locked), i18n:check green. Create/join = existing join-by-code (no invite-link). Human-verify (docker build + visual) owned by the lead, PENDING. (code-complete)
- Phase 2 (02-03 done): per-cookbook isolation enforced server-side in TWO layers — canAccessResource(action,userId,ownerId,resourceHouseholdId,requesterMemberHouseholdIds,isServerAdmin) for item access (household level = member-of-the-recipe's-cookbook; NULL household = owner-only) AND buildViewPolicyCondition for list scoping. canAccessHouseholdResource kept unchanged (groceries/calendar/stores items lack household_id; member-overlap is correct). Dedicated DB + tRPC isolation suites, adversarially verified RED-when-weakened on both layers. Found+fixed a latent dedup bug (recipeExistsByUrlForPolicy `!== null` vs drizzle undefined). getRecipeFull/dashboardRecipe/listRecipes select+map householdId (fixed the deferred 49 db failures, a 02-01 prod omission). HOUSE-06 complete. (done)

### Pending Todos

- HUMAN-VERIFY 02-04 (LEAD-owned, PENDING): build the stack on LXC 110 (docker build + full-stack smoke) and present the visual verification to the user — confirm the Cookbook switcher (households + Personal, active marked) on desktop + mobile, per-cookbook recipe-list isolation when switching, the import active-cookbook target, Dutch switcher strings, AND the 02-02 signup own-cookbook + OIDC interaction UX. Resume signal: "approved" or issues. (see 02-04-SUMMARY.md "Next Phase Readiness" for the exact how-to-verify steps)
- Follow-up (non-blocking, spawned task): fix syncRecipeIngredientsTx unit normalization — 3 pre-existing @norish/db updateRecipeWithRefs tests (create path normalizes units, update path does not; predates Phase 2).
- Phase 3 (AssemblyAI) remains unplanned; independent of Phase 2.
