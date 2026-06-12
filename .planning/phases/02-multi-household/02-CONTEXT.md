# Phase 2: Multi-household / Multi-cookbook - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

A user may belong to **multiple households (cookbooks)** simultaneously — e.g. a friend-group cookbook, a partner cookbook, and personal recipes. The user picks an **active** cookbook and switches between them; recipes are scoped **per cookbook for everyone**, and per-cookbook isolation is **security-critical** (one household must never see another household's recipes). Import/create assigns the recipe to the active cookbook.

This phase delivers: the schema to scope recipes per household + an active-household pointer; the backend rewrite (repositories, tRPC context/middleware, households router) so the *active* household drives all scoping; the per-cookbook permission boundary with dedicated isolation tests; and the frontend switcher + assign-to-cookbook UX + i18n.

Out of scope (deferred to v2 / other phases): moving a recipe between cookbooks, per-cookbook permission policy overrides (HOUSE-08), and any mobile-app (`apps/mobile`) work.

</domain>

<decisions>
## Implementation Decisions

### Recipe scoping model
- **D-01:** Add `recipes.household_id uuid NULL REFERENCES households(id) ON DELETE SET NULL`. `NULL` = **personal** (owner-only) recipe. This is preferred over a separate `recipe↔cookbook` join table because a recipe lives in **exactly one** cookbook (or none = personal); a 1:N FK is the minimal, upstream-idiomatic shape and matches how `recipes.userId` already works. Moving a recipe between cookbooks (a future M:N-ish need) is explicitly deferred (HOUSE-08).
- **D-02:** Add index `idx_recipes_household_id ON recipes(household_id)` — every recipe-list query filters by it.
- **D-03:** Recipe **visibility** is scoped by `recipes.household_id = <active household id>` (plus `household_id IS NULL AND userId = <me>` for the viewer's personal recipes, plus orphan handling — see D-14), **replacing** the current `recipes.userId IN (householdUserIds)` model. The `household` value of `recipe_permission_policy` is reinterpreted per-cookbook (see D-09).

### Active household mechanism
- **D-04:** Add `user.active_household_id uuid NULL REFERENCES households(id) ON DELETE SET NULL`. A **dedicated column** (not `user.preferences` JSONB) is used for FK integrity (auto-null on household delete) and a clean `getActiveHouseholdForUser` join. `NULL` active = **personal cookbook** view (only the user's own `household_id IS NULL` recipes).
- **D-05:** **`getHouseholdForUser(userId)` is replaced by `getActiveHouseholdForUser(userId)`** as the single resolver that all context/middleware/auth call sites use. It resolves the user's `active_household_id`; if that is null OR the user is no longer a member of it, it returns `null` (= personal view) and self-heals the stale pointer. This is the central seam: switching to active-household at this one function makes **all member-scoped secondary repos** (groceries, calendar, allergies, caldav) automatically follow the active cookbook, because they already scope by `ctx.userIds` derived from this resolver.
- **D-06:** Add repository functions: `getHouseholdsForUser(userId)` (list all memberships, for the switcher), `getActiveHouseholdForUser(userId)` (active, member-validated), `setActiveHousehold(userId, householdId | null)` (validates membership, updates the column). `getHouseholdMemberIds` changes signature from `(userId)` to `(householdId)` — callers that want "the active household's members" resolve the active household first.

### Multi-membership
- **D-07:** Remove the single-household guard in `addUserToHousehold` (repo) AND the "already in a household" `CONFLICT` guards in the households router `create` + `join`. A user may now hold many `household_users` rows (the composite-PK M:N join already supports this).
- **D-08:** On `create`/`join`, set the new household as the user's **active** household (`setActiveHousehold`). On `leave`/`kick`: if the left/kicked household was active, reset active to `null` (personal) — handled by the `ON DELETE SET NULL` FK when the household is deleted, and explicitly in the leave/kick paths otherwise.

### recipe_permission_policy reconciliation
- **D-09:** Keep the existing `recipe_permission_policy` (`view`/`edit`/`delete` ∈ `everyone|household|owner`) shape — **no schema change** to the policy. Reinterpret semantics for the cookbook model:
  - `everyone` → any user, any cookbook (server-wide) — unchanged.
  - `household` → scoped to the recipe's **own `household_id`** (the cookbook it belongs to) AND the requester must be a **member of that cookbook**. (Previously "owner ∈ my single household".) This is the per-cookbook boundary.
  - `owner` → only `recipes.userId === requester` (+ orphan) — unchanged.
- **D-10:** A **per-cookbook policy override** (different policy per household) is **deferred to v2** (HOUSE-08). v1 uses the single server-wide policy reinterpreted per the recipe's cookbook.

### Isolation rule (security-critical)
- **D-11:** The boundary is enforced **server-side** in `permissions.ts` (`canAccessResource` / `canAccessHouseholdResource`) AND in the list/query scoping (`buildViewPolicyCondition`). A recipe is accessible to a requester only if: requester is the owner; OR requester is server admin; OR policy=`everyone`; OR (policy=`household` AND recipe.`household_id` is non-null AND requester is a **member** of `recipe.household_id`). A recipe with `household_id` belonging to a cookbook the requester is NOT a member of is **never** visible/editable/deletable, regardless of the active selection.
- **D-12:** `canAccessResource` signature changes: it must receive the recipe's `householdId` (and the requester's set of **member household ids**), not the flat `householdUserIds`. The requester's membership set is derived once in middleware (`ctx.memberHouseholdIds`).

### Unique constraint
- **D-13:** Replace `uq_recipes_url_user` (on `(url, userId)`) with `uq_recipes_url_household` on `(url, household_id)`. Rationale: dedup is now per-cookbook — two cookbooks may legitimately hold the same URL; the same cookbook should not. NULL `household_id` (personal) rows are NOT de-duplicated by Postgres unique semantics (NULLs are distinct), which matches "personal recipes can coexist". Update `createRecipeWithRefs` `onConflictDoNothing` target, `findExistingRecipe`, `recipeExistsByUrlForPolicy`, and `getRecipeByUrl` accordingly.

### Orphan recipes
- **D-14:** Existing behavior — recipes with `userId IS NULL` (owner deleted) stay visible to everyone — is **retained**. Combined with `household_id IS NULL` after backfill, the personal/orphan handling in `buildViewPolicyCondition` must distinguish "my personal recipe" (`household_id IS NULL AND userId = me`) from "orphan" (`userId IS NULL`). Both remain visible to the viewer; cross-cookbook recipes do not.

### Migration / backfill
- **D-15:** One new Drizzle migration `0035_*` (generated via `pnpm db:generate`, never hand-written SQL except where drizzle-kit can't express it). It: adds `recipes.household_id` + index; adds `user.active_household_id`; drops `uq_recipes_url_user`; adds `uq_recipes_url_household`. **Backfill:** existing recipes get `household_id = NULL` (personal) — correct for this instance (1 user / 9 recipes / **0 households**), so no data needs reassignment. The migration **auto-applies at boot** via `migrate()` in `packages/api/src/startup/migrations.ts`. The constraint swap is safe because there are 0 households and the personal rows (NULL) don't collide.

### Claude's Discretion
- Exact switcher UI placement (navbar dropdown vs. dedicated control) and visual styling — match upstream heroui patterns.
- Whether `getActiveHouseholdForUser` reuses the existing `cached-household` Redis cache (re-keyed) or adds a parallel cache — keep it cache-correct on switch either way.
- Naming of the new tRPC procedures (`households.list`, `households.switchActive`) — match upstream router naming.
- Test file organization within the existing `__tests__` layout.

</decisions>

<specifics>
## Specific Ideas

- The user's mental model: "a friend-group cookbook, a partner cookbook, and personal recipes" — so the switcher must always offer a **Personal** option (active = null) in addition to each joined household.
- Keep diffs minimal and re-baseable against upstream norish (CLAUDE.md hard constraint). Prefer extending the existing shared-react factory hooks/contexts over new bespoke components.
- The active-household switch should refetch the recipe list (and groceries/calendar, which follow automatically via `ctx.userIds`).

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Hard constraints / process
- `CLAUDE.md` — fork hard constraints: complete work/no placeholders, match upstream style, pnpm@10.33.2, ESM/TS 5.9, Drizzle migrations auto-applied at boot, per-cookbook isolation is security-critical and must be server-side + tested.
- `.planning/PROJECT.md` — Key Decisions (recipes.household_id + active-household), constraints.
- `.planning/REQUIREMENTS.md` — HOUSE-01..07 acceptance criteria + traceability.

### Schema (Plan 02-01)
- `packages/db/src/schema/recipes.ts` — `recipes` table; `uq_recipes_url_user` to swap; add `household_id` + index.
- `packages/db/src/schema/auth.ts` — `user` table; add `active_household_id`.
- `packages/db/src/schema/households.ts`, `household-users.ts` — M:N join (composite PK) already supports multi-membership.
- `packages/db/src/schema/relations.ts` §22 (`recipesRelations`) — add `household` relation; §120 `householdsRelations`.
- `packages/shared/src/contracts/zod/recipe.ts` §17/§50/§60 — `RecipeSelectBaseSchema` (re-declares `userId` nullable; add `householdId` nullable), `FullRecipeSchema`, `FullRecipeInsertSchema` (omits `userId` — omit `householdId` too; set server-side).
- `packages/api/src/startup/migrations.ts` — boot-time `migrate()`; `packages/db/src/drizzle.config.ts` — `pnpm db:generate` writes to `src/migrations/`.

### Backend repositories + seam (Plan 02-02)
- `packages/db/src/repositories/households.ts` — `getHouseholdForUser` (→ replace/augment with active resolver), `getHouseholdMemberIds(userId)` (→ `(householdId)`), `addUserToHousehold` (remove guard); add `getHouseholdsForUser`, `getActiveHouseholdForUser`, `setActiveHousehold`.
- `packages/db/src/repositories/recipes.ts` §225 `RecipeListContext`, §236 `buildViewPolicyCondition`, §129 `recipeExistsByUrlForPolicy`, §185 `findExistingRecipe`, §107 `getRecipeByUrl`, §620 `createRecipeWithRefs` (conflict target + set household_id), §1391 favorites/ratings inline scope.
- `packages/db/src/cached-household.ts` — re-key for active-household; invalidate on switch.
- `packages/trpc/src/context.ts` §52 (`getHouseholdForUser` → active), `packages/trpc/src/middleware.ts` §30-62 (`withAuth` derives `householdUserIds`/`householdKey`/`userIds`; add `memberHouseholdIds`; optionally honor `x-active-household` header).
- `packages/trpc/src/routers/households/households.ts` — remove `create`/`join` guards; add `list` query + `switchActive` mutation; keep leave/kick/regenerate/transferAdmin.
- `packages/trpc/src/routers/recipes/recipes.ts` §94/§350 (list/import build `RecipeListContext`; create passes household), §183 `createRecipeWithRefs` call.
- `packages/queue/src/contracts/job-types.ts` — `RecipeImportJobData`/`ImageImportJobData`/`PasteImportJobData`/`NutritionEstimationJobData` carry `householdUserIds`; add `householdId` for recipe assignment.
- `packages/queue/src/recipe-import/{producer,worker}.ts`, `paste-import/worker.ts`, `image-import/worker.ts` — set `household_id` on created recipes via the job's `householdId`; pass through dedup.
- Member-scoped secondary repos that follow the active household **via `ctx.userIds`/`getHouseholdMemberIds` only** (no recipe `household_id`): `packages/db/src/repositories/groceries.ts` (`getGroceriesForHousehold`, create/markAllDone — take member ids from caller), `packages/queue/src/allergy-detection/{producer,worker}.ts` + `packages/db/src/repositories/users.ts` `getAllergiesForUsers`, `packages/db/src/repositories/planned-items.ts` (calendar — `userIds` param), `packages/api/src/caldav/household-deduplication.ts`, `packages/queue/src/scheduler/recurring-grocery-check.ts`.
- Other `getHouseholdForUser` callers to update: `packages/auth/src/withAuth.ts` §49 (`requireUserAndHousehold`), `packages/auth/src/claim-processor.ts` §275 (OIDC household assignment — reconsider single-household assumption), `packages/trpc/src/routers/user/user.ts` §282 (`deleteAccount` admin check — iterate all admin'd households).

### Permissions + isolation (Plan 02-03)
- `packages/auth/src/permissions.ts` — `canAccessResource` (signature: take recipe `householdId` + requester member household ids), `canAccessHouseholdResource`, `assertHouseholdAccess`, `getRecipePermissionPolicy`.
- `packages/trpc/src/routers/recipes/helpers.ts` §51 `assertRecipeAccess`, §80 `findRecipeForViewer` — pass recipe `householdId` into `canAccessResource`.
- `packages/auth/__tests__/permissions.test.ts`, `packages/trpc/__tests__/recipes/permissions-integration.test.ts` — extend for per-cookbook isolation.

### Frontend + i18n (Plan 02-04)
- `packages/shared-react/src/contexts/households/household-context.tsx` — `createHouseholdContext`/`createHouseholdSettingsContext` factories; extend `HouseholdContextValue` with `households`, `activeHouseholdId`, `switchActive`.
- `packages/shared-react/src/hooks/households/{types.ts,index.ts,use-household-query.ts,use-household-mutations.ts,use-household-subscription.ts,use-household-cache.ts}` — add list query + switchActive mutation + cache helpers.
- `apps/web/context/household-context.tsx`, `apps/web/hooks/households/*`, `apps/web/components/navbar/{navbar-user-menu.tsx,mobile-nav.tsx}` — switcher UI (+Personal option).
- `apps/web/components/shared/{import-recipe-modal.tsx,import-from-image-modal.tsx,import-from-paste-modal.tsx}`, `apps/web/context/recipes-context.tsx` — assign-to-cookbook UX (defaults to active).
- **i18n:** `packages/i18n/src/messages/<locale>/{navbar,settings}.json` and the gate `packages/i18n/scripts/check-locale-keys.js` (run via `pnpm i18n:check`). **Source of truth is `en`; the gate fails on ANY missing key in ANY of the 11 locales** (da, de-formal, de-informal, en, es, fr, it, ko, nl, pl, ru). New keys MUST be added to **all 11 locales**, not only nl+en.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **M:N join already exists** (`household_users` composite PK) — multi-membership is code-only; no join-table creation needed.
- **Single central resolver:** every household-scoped read funnels through `getHouseholdForUser` (context, middleware, withAuth, permissions, scheduler, user router). Replacing it with `getActiveHouseholdForUser` flips the whole app to active-household with minimal surface.
- **Member-scoped secondary repos take id arrays as params** (`listGroceriesByUsers(ctx.userIds)`, `listPlannedItemsBy...(userIds)`, `getAllergiesForUsers(userIds)`). They need **zero internal change** — only the caller's `ctx.userIds`/`memberHouseholdIds` must reflect the active household. This dramatically narrows the blast radius.
- **shared-react factory pattern** (`createHouseholdContext`, `createHouseholdHooks`, `createUseHouseholdMutations`) — extend in place; web wrappers are thin.
- **`user.preferences` JSONB** with safe read/merge exists, but D-04 chooses a dedicated FK column instead.
- **`emitToHousehold(householdKey, ...)`** realtime events already key by household id — they continue to work once `householdKey` = active household id.

### Established Patterns
- Optimistic-concurrency via `version` column + `MutationOutcome` (stale/applied) on all mutations — `setActiveHousehold` should follow it.
- Zod `createSelectSchema`/`createInsertSchema` with explicit re-declaration of nullable FK fields (`userId`) — mirror for `householdId`.
- Drizzle migrations are generated (`pnpm db:generate`) and **auto-applied at boot** — never hand-edit applied SQL; generate a new one.
- Queue jobs carry the scoping context (`householdUserIds`, `householdKey`) in their payload — add `householdId` the same way.

### Integration Points
- `tRPC context/middleware` is THE seam where active household enters: `ctx.household`, `ctx.householdKey`, `ctx.userIds`, `ctx.householdUserIds`, plus new `ctx.memberHouseholdIds`.
- `recipes.household_id` is set at recipe creation (router create + the three import workers) from the active household.
- `cached-household` Redis cache must invalidate on `switchActive` and on join/leave/kick (existing `invalidateHouseholdCacheForUsers` is reused).

</code_context>

<deferred>
## Deferred Ideas

- **HOUSE-08 (v2):** Move a recipe between cookbooks; per-cookbook permission policy overrides (different `recipe_permission_policy` per household).
- **OIDC multi-household claims:** auto-joining a user to *multiple* OIDC household groups (claim-processor currently assigns one). v1 keeps the first-match/active behavior; full multi-claim is a follow-up.
- Mobile app (`apps/mobile`) household switcher — out of project scope (web is the target).
- Recurring-grocery scheduler per-household targeting beyond active-household-key — low-risk, left as-is for v1.

</deferred>

---

*Phase: 02-multi-household*
*Context gathered: 2026-06-12*
