---
gsd_state_version: '1.0'
status: planning
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 11
  completed_plans: 6
  percent: 55
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-12)

**Core value:** Reliable recipe import & management for Kiran's groups, incl. bot-protected sources, with no extra setup vs upstream.
**Current focus:** Phase 2 — Multi-household cookbooks (executing; wave 1 of 4 complete)

## Current Position

Phase: 2 of 3 (Multi-household cookbooks)
Plan: Executing — 02-01 of 4 complete; next is 02-02 (backend core)
Status: In Progress
Last activity: 2026-06-13 — 02-01 (schema + migration) shipped: nullable recipes.household_id + user.active_household_id (uuid FK households, ON DELETE SET NULL), unique-constraint swap (url,userId)→(url,household_id) + idx_recipes_household_id, recipes→household relation, householdId in recipe zod select; generated migration 0035_whole_drax, verified to apply 0000→0035 against a throwaway Postgres 17. AnyPgColumn annotation added to break the user↔households type-inference cycle (also cleared 2 pre-existing households-repo errors). HOUSE-04, HOUSE-05 complete.

Progress: [██████░░░░] 55%

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

### Pending Todos

- Review + approve the Phase 2 plan, then `/gsd-execute-phase 2` (waves 1→4; 02-04 has a human-verify checkpoint).
- Phase 3 (AssemblyAI) remains unplanned; independent of Phase 2.
