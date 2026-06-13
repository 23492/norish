---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 11
  completed_plans: 7
  percent: 64
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12)

**Core value:** Reliable recipe import & management for Kiran's groups, incl. bot-protected sources, with no extra setup vs upstream.
**Current focus:** Phase 2 — Multi-household cookbooks (executing; wave 2 of 4 complete)

## Current Position

Phase: 2 of 3 (Multi-household cookbooks)
Plan: Executing — 02-02 of 4 complete; next is 02-03 (permissions + per-cookbook isolation tests)
Status: In Progress
Last activity: 2026-06-13 — 02-02 (backend active-household core) shipped: flipped the app to active-household at the tRPC context/middleware seam (getActiveHouseholdForUser drives scoping; new ctx.memberHouseholdIds); multi-membership enabled (create/join guards removed); households.list + switchActive; recipe visibility/dedup/creation rewritten to recipes.household_id; householdId threaded through the recipe/image/paste import queue + archive chain; signup now auto-creates each user's OWN cookbook (set active) via the better-auth user.create.after hook (coexists with the OIDC claim path — both documented for human-verify). All production code typecheck+lint green; the @norish/trpc (32) / @norish/db (49) unit failures are contract-only (db ones pre-exist at baseline) and are fixed by 02-03's test updates. HOUSE-01, HOUSE-02, HOUSE-03, HOUSE-07 complete (HOUSE-04/05 already done).

Progress: [██████░░░░] 64%

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

### Pending Todos

- Execute Plan 02-03 (permissions + per-cookbook isolation tests). It must: wire canAccessResource to take recipe household_id + ctx.memberHouseholdIds (already forwarded); update @norish/trpc mocks to stub getHouseholdsForUser (fixes the 32 contract-only fails) + @norish/db fixtures for householdId (fixes the 49 pre-existing fails); add the HOUSE-06 isolation suites. Then 02-04 (frontend + i18n, has a human-verify checkpoint).
- Phase 3 (AssemblyAI) remains unplanned; independent of Phase 2.
