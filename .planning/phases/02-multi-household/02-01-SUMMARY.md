---
phase: 02-multi-household
plan: 01
subsystem: database
tags: [drizzle, postgres, schema, migration, zod, households, multi-tenant]

requires:
  - phase: 01-camofox-scraping
    provides: stable fork baseline on LXC 110 (pnpm workspaces, Drizzle 0.45, migrations auto-applied at boot)
provides:
  - recipes.household_id column (nullable uuid, FK households ON DELETE SET NULL; NULL = personal)
  - user.active_household_id column (nullable uuid, FK households ON DELETE SET NULL; active-cookbook pointer)
  - recipes unique constraint swapped from (url, userId) to (url, household_id) + idx_recipes_household_id
  - recipes->household Drizzle relation
  - householdId in recipe zod select/full schemas (omitted from insert; server-set)
  - generated migration 0035_whole_drax (auto-applies at boot)
affects: [02-02-backend-core, 02-03-permissions-isolation-tests, 02-04-frontend-i18n]

tech-stack:
  added: []
  patterns:
    - "AnyPgColumn return-type annotation on FK reference callbacks to break Drizzle mutual/self-reference type-inference cycles"
    - "NULL household_id = personal recipe; Postgres treats NULLs as distinct under the (url, household_id) unique constraint, so personal recipes never collide"

key-files:
  created:
    - packages/db/src/migrations/0035_whole_drax.sql
    - packages/db/src/migrations/meta/0035_snapshot.json
  modified:
    - packages/db/src/schema/recipes.ts
    - packages/db/src/schema/auth.ts
    - packages/db/src/schema/relations.ts
    - packages/shared/src/contracts/zod/recipe.ts
    - packages/db/src/migrations/meta/_journal.json

key-decisions:
  - "recipes.household_id and user.active_household_id are nullable uuid FKs to households with ON DELETE SET NULL; NULL = personal/active-none (no behavior change to the running app beyond additive columns)."
  - "Annotated user.activeHouseholdId references callback with AnyPgColumn (drizzle-orm/pg-core) to break the user<->households mutual-reference cycle that otherwise collapses both pgTable types to any under tsc --noEmit (Drizzle TS limitation; canonical fix per Drizzle docs)."
  - "recipes.householdId did NOT need the annotation (one-way edge, like the pre-existing recipes.userId)."

patterns-established:
  - "FK callback annotation: .references((): AnyPgColumn => target.id, { onDelete: ... }) wherever a new edge closes a table-reference cycle"

requirements-completed: [HOUSE-04, HOUSE-05]

duration: ~35 min
completed: 2026-06-13
---

# Phase 02 Plan 01: Schema + Migration Summary

**Per-cookbook recipe scoping data model: nullable `recipes.household_id` + `user.active_household_id` uuid FKs to households (ON DELETE SET NULL), the `(url, household_id)` unique-constraint swap, and generated Drizzle migration `0035_whole_drax` verified to apply 0000->0035 cleanly at boot.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-06-13
- **Tasks:** 4 (tasks 1-3 code pre-applied by lead; verified + task 4 migration generated here)
- **Files modified:** 5 (4 source + journal); 2 created (migration sql + snapshot)

## Accomplishments
- Verified the pre-applied schema/zod edits (tasks 1-3) against every acceptance criterion: household_id column + idx_recipes_household_id + uq_recipes_url_household in recipes.ts (uq_recipes_url_user removed); active_household_id + uuid import in auth.ts; recipes->household relation in relations.ts; householdId in recipe zod select (omitted from insert).
- Generated migration `0035_whole_drax.sql` via `drizzle-kit generate`; it ADDs both nullable uuid columns + FKs, CREATEs idx_recipes_household_id, DROPs uq_recipes_url_user, ADDs uq_recipes_url_household. Idempotent on re-run ("No schema changes, nothing to migrate").
- Applied all migrations (0000..0035) against a throwaway Postgres 17 (never the live DB) -> "migrations applied successfully!"; psql-verified the resulting schema (both columns nullable uuid, single uq_recipes_url_household, idx present, both FKs confdeltype=n=SET NULL, 36 journal rows).
- Fixed a real type-inference defect the additive edits introduced (Drizzle mutual-reference cycle) with the canonical AnyPgColumn annotation; this also cleared 2 pre-existing households-repository cascade errors, leaving `@norish/db` typecheck fully green.

## Task Commits

1. **Tasks 1-3: schema + zod (incl. AnyPgColumn fix)** - `ab3e8eab` (feat)
2. **Task 4: generate drizzle migration 0035** - `260288a8` (feat)

**Plan metadata:** this SUMMARY commit (docs)

## Files Created/Modified
- `packages/db/src/schema/recipes.ts` - household_id uuid FK column, idx_recipes_household_id, uq_recipes_url_household (replacing uq_recipes_url_user); idx_recipes_user_id retained
- `packages/db/src/schema/auth.ts` - user.active_household_id uuid FK column; AnyPgColumn-annotated reference callback; uuid + households imports
- `packages/db/src/schema/relations.ts` - recipesRelations gains household: one(households,...); householdsRelations gains recipes: many(recipes)
- `packages/shared/src/contracts/zod/recipe.ts` - householdId: z.string().nullable() in RecipeSelectBaseSchema; householdId omitted from RecipeInsertBaseSchema
- `packages/db/src/migrations/0035_whole_drax.sql` - the generated migration
- `packages/db/src/migrations/meta/0035_snapshot.json` - drizzle snapshot for 0035
- `packages/db/src/migrations/meta/_journal.json` - journal entry idx 35

## Decisions Made
- See key-decisions in frontmatter. The columns are additive and default to NULL (personal), so there is no behavior change to the running app; the household/active-household semantics are wired up by later plans (02-02+).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug introduced by current task] AnyPgColumn annotation to break the user<->households type cycle**
- **Found during:** Verification of Task 2 (`pnpm --filter @norish/db typecheck`)
- **Issue:** The pre-applied `user.activeHouseholdId -> households.id` edit added a second cross-edge to the existing `households.adminUserId -> users.id` edge, forming a mutual reference. Under `tsc --noEmit` (strict), this collapsed both the `users` and `households` pgTable types to `any` (TS7022/TS7024), cascading 8 errors across `schema/auth.ts`, `schema/households.ts`, `repositories/recipes.ts`, and `repositories/users.ts`. Proven by stash-in/stash-out diff: the cascade appears only with the 02-01 edits applied.
- **Fix:** Annotated the new back-edge `activeHouseholdId: uuid("active_household_id").references((): AnyPgColumn => households.id, {...})` and imported `type AnyPgColumn` from `drizzle-orm/pg-core`. This is the canonical Drizzle fix for self/mutual-referential FKs (verified against Drizzle docs: "due to TypeScript limitations, you must explicitly set the return type for the reference callback"). `recipes.householdId` is a one-way edge (like `recipes.userId`) and did not need it.
- **Files modified:** packages/db/src/schema/auth.ts
- **Verification:** `pnpm --filter @norish/db typecheck` and `pnpm --filter @norish/shared typecheck` both exit 0 / fully clean (no-cache re-run confirmed). The fix additionally cleared 2 pre-existing `repositories/households.ts` cascade errors (TS2769 insert-overload + TS7006 implicit-any) that share the same root cause.
- **Committed in:** ab3e8eab (Task 1-3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug introduced by the plan's own additive edit).
**Impact on plan:** Single-line, canonical, minimal annotation; keeps the diff re-baseable. Net-new type errors from 02-01 = 0 (strictly better: `@norish/db` typecheck went from 2 pre-existing errors to fully green). No scope creep into 02-02.

## Issues Encountered
- pnpm `injectWorkspacePackages: true` + `node-linker=hoisted` copies `@norish/db` into `node_modules` rather than symlinking, and did not re-materialize the injected copy on `pnpm install --frozen-lockfile`/`--force` after a source edit. Resolved by syncing the three modified `schema/*.ts` files into `node_modules/@norish/db/src/schema/` (exactly what injection does) so downstream `@norish/shared` typecheck resolves against the fixed source. This is a node_modules-resolution artifact only; the source files and migration are correct, and the lead's `pnpm docker:build` re-injects from source.
- `drizzle.config.ts` validates env on load; `drizzle-kit generate`/`migrate` were run with a dummy `DATABASE_URL` + `NODE_ENV=development` + `SKIP_ENV_VALIDATION=1`. `generate` does not connect to any DB; `migrate` connected only to the throwaway Postgres on 127.0.0.1:55432.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema primitives + migration are in place and boot-verified. Ready for 02-02 (backend core: getActiveHouseholdForUser seam, member-scoped repos).
- Note for 02-02: `packages/db/src/repositories/households.ts` had 2 pre-existing type errors on this branch that the AnyPgColumn fix incidentally resolved; the repository there is now type-clean.

## Self-Check: PASSED

Re-ran all task acceptance criteria + the plan-level <verification>:
- Task 1: recipes.ts has household_id + references(() => households.id, idx_recipes_household_id, uq_recipes_url_household; uq_recipes_url_user ABSENT; households import present; idx_recipes_user_id retained. PASS
- Task 2: auth.ts has active_household_id + references(() => households.id (AnyPgColumn-annotated), uuid imported, column nullable (no .notNull()). PASS
- Task 3: relations.ts has household: one(households; recipe.ts select base has householdId: z.string().nullable() and insert omit has householdId: true. PASS
- Task 4: 0035_whole_drax.sql exists with uq_recipes_url_household + idx_recipes_household_id + active_household_id + DROP CONSTRAINT uq_recipes_url_user; _journal.json has the 0035 entry; 0035_snapshot.json exists; generate is idempotent. PASS
- <verification>: db typecheck PASS, shared typecheck PASS, exactly one 0035 migration (no re-run drift) PASS, generated SQL swaps the unique constraint + adds both nullable columns PASS, migration applies 0000..0035 with no error against a throwaway DB PASS, db lint + shared lint 0 errors PASS.

---
*Phase: 02-multi-household*
*Completed: 2026-06-13*
