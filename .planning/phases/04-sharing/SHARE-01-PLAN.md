---
phase: 04-sharing
plan: SHARE-01
subsystem: api
tags: [trpc, drizzle, recipe-shares, visibility, public-endpoint, isolation, next-intl]
requirements: [SHARE-01]
---

# Phase 04 Plan SHARE-01: Per-recipe visibility (private/household/public) on the existing recipe_shares share-link feature

<context>
norish ALREADY ships a complete, wired tokenized share feature (recipe_shares table + repo + recipes.shares tRPC router + sharedRecipeProcedure + the public /share/[token] page + media routes + a recipe Share panel + admin/user share-link settings cards). It does NOT have an explicit per-recipe visibility level. Today "public" is IMPLICIT: any active share token reaches the recipe.

This plan adds the LOCKED visibility model on TOP of that feature:
- recipes.visibility enum: private (default) | household | public.
- The public route is gated on visibility === "public": a private/household recipe is NOT reachable by /share/<token> even if a share row exists.
- Creating a share link makes the recipe public (sets visibility = public); revoking the last active share returns it to private. Visibility can also be set directly.
- Who can share / set visibility: a user with EDIT permission on the recipe (owner or cookbook admin) — already enforced by assertRecipeAccess(...,"edit").
- Standardize the share token to crypto.randomBytes(32).toString("base64url") (was 24).
- Public endpoint keeps returning ONLY PublicRecipeViewSchema (single recipe, no ids/owner/other recipes/cookbook listing).
- No public gallery. SHARE-02 (save-to-account) OUT OF SCOPE.

REGRESSION GUARD (the 02-06 lesson): recipes.visibility is added to a table whose RecipeSelectBaseSchema = createSelectSchema(recipes), and getRecipeFull/dashboardRecipe/listRecipes build EXPLICIT dto objects + safeParse. Adding a NOT NULL column makes the derived schemas REQUIRE it. We must keep every recipe safeParse green: carry visibility through FullRecipeSchema + getRecipeFull's columns+dto (the recipe page needs it), and OMIT it from RecipeDashboardSchema (dashboard/list don't need it, and their mappers don't supply it).
</context>

<interfaces>
- packages/db/src/schema/recipes.ts: `recipes` pgTable; add `recipeVisibilityEnum` pgEnum + `visibility` column (NOT NULL default 'private').
- packages/shared/src/contracts/zod/recipe.ts: `RecipeSelectBaseSchema = createSelectSchema(recipes).extend({...})`; `RecipeDashboardSchema = RecipeSelectBaseSchema.omit({...})`; `FullRecipeSchema = RecipeSelectBaseSchema.extend({...})`. Add `recipeVisibilities`/`RecipeVisibilitySchema`; omit `visibility` in the dashboard; keep it in Full.
- packages/db/src/repositories/recipes.ts: `getRecipeFull` (columns allowlist + dto + FullRecipeSchema.safeParse @ ~1037), `dashboardRecipe` (~640), `listRecipes` formatted map (~575), `getRecipeByUrl` (delegates to getRecipeFull). Add `setRecipeVisibility(recipeId, visibility, version)` + `getRecipeVisibility(recipeId)` repo fns.
- packages/db/src/repositories/recipe-shares.ts: `createRecipeShare` (token = randomBytes(24) -> 32); `getActiveRecipeShareByToken`/`getPublicRecipeView` (public path). Gate public resolution on recipe visibility = public.
- packages/trpc/src/middleware.ts: `sharedRecipeProcedure` resolves the share by token then loads the recipe — add the visibility=public gate here (single choke point for the public surface).
- packages/trpc/src/routers/recipes/shares.ts: `create` (sets visibility=public after creating a share), `revoke`/`shareDelete` (return to private if no active shares remain), + a new `setVisibility` authedProcedure (assertRecipeAccess edit). Output via RecipeShare* schemas.
- packages/auth/src/permissions.ts canAccessResource / assertRecipeAccess(...,"edit") — REUSE; do not change.
- apps/web/app/(app)/recipes/[id]/components/recipe-share-panel.tsx — surface current visibility + a control; reuse existing create/revoke.
- i18n: packages/i18n/src/messages/<11 locales>/*.json — visibility strings (nl+en real, 9 EN-fallback).
</interfaces>

<task type="auto" tdd="false">
**Task 1: Schema + zod + migration for recipes.visibility**

<read_first>
- packages/db/src/schema/recipes.ts
- packages/shared/src/contracts/zod/recipe.ts
- packages/db/src/repositories/recipes.ts (getRecipeFull ~883-1045, dashboardRecipe ~640, listRecipes formatted ~575, getRecipeByUrl ~158)
- .planning/phases/02-multi-household/02-06-SUMMARY.md (the createSelectSchema regression + its omit fix)
</read_first>

- Add `recipeVisibilityEnum = pgEnum("recipe_visibility", ["private","household","public"])` and a `visibility` column on `recipes`: `recipeVisibilityEnum("visibility").notNull().default("private")`. Place it near systemUsed; mirror upstream column style.
- packages/shared/src/contracts/zod/recipe.ts:
  - Export `recipeVisibilities = recipeVisibilityEnum.enumValues` and `RecipeVisibilitySchema = z.enum(recipeVisibilities)` (mirror `measurementSystems`).
  - `RecipeSelectBaseSchema` will now include `visibility` automatically (createSelectSchema). Add `visibility: RecipeVisibilitySchema` to the `.extend({...})` to make the type explicit/stable.
  - `RecipeDashboardSchema`: add `visibility: true` to the existing `.omit({...})` (dashboard/list don't carry it — prevents the mapper-vs-zod break).
  - `FullRecipeSchema`: keep visibility (inherited from base) — the recipe detail page reads it.
- getRecipeFull: add `visibility: true` to the `columns` allowlist AND `visibility: full.visibility` to the `dto` object (so FullRecipeSchema.safeParse @ ~1037 stays green). getRecipeByUrl delegates to getRecipeFull (no change needed beyond Task1).
- dashboardRecipe + listRecipes: NO change to their dto/formatted objects (visibility is omitted from RecipeDashboardSchema).
- Generate the migration via drizzle-kit with a dummy DATABASE_URL + SKIP_ENV_VALIDATION (see 02-01-SUMMARY). Expect `0038_*`. The migration must ADD the enum type + ADD COLUMN visibility NOT NULL DEFAULT 'private' (existing rows backfill to private — fail-safe).

<acceptance_criteria>
- `grep -nE "recipe_visibility|visibility" packages/db/src/schema/recipes.ts` shows the enum + column.
- `ls packages/db/src/migrations/0038_*.sql` exists and contains `CREATE TYPE` (recipe_visibility) + `ADD COLUMN "visibility"` with `DEFAULT 'private'` NOT NULL.
- `grep -nE "RecipeVisibilitySchema|recipeVisibilities" packages/shared/src/contracts/zod/recipe.ts` present; RecipeDashboardSchema omit includes visibility; getRecipeFull columns+dto include visibility.
- typecheck db + shared EXIT 0.
- DB recipe suites still green (real-parse): `pnpm --filter @norish/db test -- recipes` and the recipe-shares repo test pass (getRecipeFull/dashboardRecipe/getRecipeByUrl do not throw "Failed to parse").
</acceptance_criteria>
</task>

<task type="auto" tdd="false">
**Task 2: Repo — visibility setters + token to randomBytes(32) + public-path visibility gate**

<read_first>
- packages/db/src/repositories/recipes.ts (around setRecipe* mutation helpers + version/optimistic patterns; reuse the existing MutationOutcome staleOutcome/appliedOutcome pattern used by recipe-shares)
- packages/db/src/repositories/recipe-shares.ts (createRecipeShare, getActiveRecipeShareByToken, getPublicRecipeView, getRecipeSharesByUserId)
- packages/db/src/repositories/mutation-outcomes.ts
</read_first>

- recipe-shares createRecipeShare: token = `crypto.randomBytes(32).toString("base64url")` (was 24).
- Add `getRecipeVisibility(recipeId): Promise<RecipeVisibility | null>` (columns-only fetch — does NOT touch getRecipeFull) and `setRecipeVisibility(recipeId, visibility, version): Promise<MutationOutcome<...>>` (optimistic version bump; mirror recipe-shares update pattern) in repositories/recipes.ts. Also `countActiveRecipeShares(recipeId): Promise<number>` (active = not revoked, not expired) for the revoke->private rule.
- Public gate (defense in depth): in getPublicRecipeView, after loading the recipe, return null if recipe.visibility !== "public". (The primary gate is in the middleware Task 3; this is the repo-level belt-and-suspenders so the helper is safe on its own — and is what the repo test asserts.)

<acceptance_criteria>
- `grep -nE "randomBytes\\(32\\)" packages/db/src/repositories/recipe-shares.ts` present (24 gone).
- `grep -nE "setRecipeVisibility|getRecipeVisibility|countActiveRecipeShares" packages/db/src/repositories/recipes.ts` present.
- getPublicRecipeView returns null when visibility !== public (asserted by a new repo test in Task 5).
- typecheck db EXIT 0.
</acceptance_criteria>
</task>

<task type="auto" tdd="false">
**Task 3: Public-route visibility gate in sharedRecipeProcedure + tRPC setVisibility + create/revoke visibility transitions**

<read_first>
- packages/trpc/src/middleware.ts (sharedRecipeProcedure)
- packages/trpc/src/routers/recipes/shares.ts (create/revoke/remove/getShared; assertRecipeAccess usage)
- packages/trpc/src/routers/recipes/helpers.ts (assertRecipeAccess)
- packages/shared/src/contracts/zod/recipe.ts (add SetRecipeVisibilityInputSchema)
</read_first>

- sharedRecipeProcedure (middleware.ts): after `getRecipeFull(share.recipeId)`, if `recipe.visibility !== "public"` throw NOT_FOUND (same opaque error as a missing token — no enumeration; private/household recipe is unreachable publicly). THIS is the primary public-surface choke point covering getShared + sharePublicConfig + any future shared procedure.
- shares.ts create mutation: after createRecipeShare succeeds, set the recipe visibility to "public" (load current version via getRecipeVisibility/owner fetch; use setRecipeVisibility; tolerate a stale race by re-reading). Keep the existing assertRecipeAccess(edit) gate.
- shares.ts revoke + remove mutations: after a successful revoke/delete, if countActiveRecipeShares(recipeId) === 0 set visibility back to "private" (so a recipe with no live public link is not "public").
- Add `setVisibility` authedProcedure: input SetRecipeVisibilityInputSchema { recipeId, visibility, version }; assertRecipeAccess(ctx, recipeId, "edit"); setRecipeVisibility; emit a recipe event (reuse emitByPolicy/recipeEmitter like the share events). Export it in recipeSharesProcedures (e.g. `shareSetVisibility`). Output a small result schema (visibility + stale).
- SetRecipeVisibilityInputSchema in shared zod: { recipeId: z.uuid(), visibility: RecipeVisibilitySchema, version: z.number().int().positive() }.

<acceptance_criteria>
- `grep -nE "visibility !== .public.|visibility !== \"public\"" packages/trpc/src/middleware.ts` present in sharedRecipeProcedure.
- `grep -nE "shareSetVisibility|setVisibility" packages/trpc/src/routers/recipes/shares.ts` present and wired into recipeSharesProcedures.
- create sets visibility public; revoke/remove revert to private when no active shares — covered by Task 5 tRPC tests.
- typecheck trpc + shared EXIT 0; lint trpc clean on touched files.
</acceptance_criteria>
</task>

<task type="auto" tdd="false">
**Task 4: Frontend — surface visibility on the recipe Share panel + i18n (11 locales)**

<read_first>
- apps/web/app/(app)/recipes/[id]/components/recipe-share-panel.tsx
- apps/web/app/(app)/recipes/[id]/context.tsx + the shared-react recipe-detail context factory (createRecipeDetailContext) for how recipe + share mutations are exposed
- packages/shared-react/src/hooks/recipes/shares/use-recipe-share-mutations.ts
- packages/i18n/src/messages/en/*.json + nl/*.json (find the recipes.sharePanel namespace file)
</read_first>

- Surface the current recipe visibility in the Share panel (a small status line or a Select with private/household/public) and let an editor change it via the new setVisibility mutation. Reuse the existing create/revoke flow: creating a link already implies public; the control should make the private/household/public state explicit + changeable. Keep the diff minimal and match the panel's existing heroui Select/Button style.
- Add the shared-react mutation hook for setVisibility (mirror the existing share mutations in use-recipe-share-mutations.ts) and expose it through the recipe-detail context if that is how the panel consumes mutations (mirror revokeShare/deleteShare wiring).
- i18n: add recipes.sharePanel.visibility.* keys (label + the 3 option labels + a short helper) to ALL 11 locales — nl + en REAL, the other 9 EN-fallback (per the locked decision). Keep keys inside the existing recipes namespace file (no new namespace registration — mirror the 02-06 i18n decision).

<acceptance_criteria>
- `grep -RnE "visibility" apps/web/app/(app)/recipes/[id]/components/recipe-share-panel.tsx` present.
- `grep -RnE "visibility" packages/i18n/src/messages/en/` and `.../nl/` present; all 11 locales contain the new keys.
- `pnpm i18n:check` EXIT 0.
- typecheck web + shared-react EXIT 0; lint web clean on touched files.
</acceptance_criteria>
</task>

<task type="auto" tdd="true">
**Task 5: Tests — visibility gate (adversarial) + real-parse + isolation; keep db households.isolation green**

<read_first>
- packages/db/__tests__/server/db/repositories/recipe-shares.test.ts
- packages/db/__tests__/helpers/db-test-helpers.ts (createTestRecipe overrides accept visibility via $inferInsert; createTestRecipeShare)
- packages/trpc/__tests__ (a representative recipes/permissions test for the mocking/style)
- packages/db/__tests__/server/db/repositories/households.isolation.test.ts (must stay green)
</read_first>

- DB repo test (real Postgres): 
  (a) getPublicRecipeView returns null for a private recipe + null for a household recipe; returns the recipe ONLY when visibility=public (with a valid token). 
  (b) Real-parse: createTestRecipe (default visibility=private) -> getRecipeFull does NOT throw and `.visibility === "private"`; a recipe created with visibility:"public" round-trips. dashboardRecipe + listRecipes still parse (the omit path).
  (c) setRecipeVisibility optimistic version bump + stale path; countActiveRecipeShares.
- tRPC test:
  (a) getShared via sharedRecipeProcedure throws NOT_FOUND for a private/household recipe even with a valid active token; returns the PublicRecipeView for a public recipe.
  (b) shareCreate sets visibility=public; revoke/remove of the last active share reverts to private.
  (c) setVisibility requires edit (a non-editor gets FORBIDDEN); the public payload contains ONLY PublicRecipeViewSchema keys (no id/userId/householdId/owner/other recipes) — assert keys.
- ADVERSARIAL: weaken the middleware gate (remove the `visibility !== "public"` check) -> the tRPC "private recipe not publicly reachable" test must go RED; revert (byte-identical), never commit the weakening. Also weaken getPublicRecipeView's repo gate -> the DB test goes RED; revert.
- Confirm packages/db households.isolation suite stays green (no cross-cookbook leak introduced).

<acceptance_criteria>
- New/updated tests pass: `pnpm --filter @norish/db test -- recipe-shares` and the recipe suite; `pnpm --filter @norish/trpc test -- recipes` (or the share/permissions suites).
- households.isolation 6/6 green.
- Adversarial: documented weaken->RED->revert for BOTH the middleware gate and the repo gate (in the SUMMARY); weakenings NOT committed.
</acceptance_criteria>
</task>

<verification>
- typecheck: db, shared, auth, trpc, shared-react, web all EXIT 0.
- `pnpm i18n:check` EXIT 0.
- lint clean on touched packages.
- Test suites: recipe + recipe-shares + permissions + household-isolation (incl. the new ones) pass; db households.isolation stays green.
- Do NOT run pnpm build / docker:build / dev-server. Do NOT push.
</verification>

<success_criteria>
1. recipes.visibility (private/household/public) exists with migration 0038; every recipe safeParse stays green (no 02-06-class regression).
2. The public route returns ONLY a public recipe's PublicRecipeView; a private/household recipe is NOT reachable by /share/<token> (adversarially proven).
3. An editor (owner/cookbook admin) can set visibility + create/revoke a share link from the recipe page; sharing rides ON TOP of POLICY-01/isolation with no cross-cookbook leak.
4. Token is crypto.randomBytes(32) base64url. i18n in all 11 locales. Static verify + tests green. Nothing built or pushed; live untouched.
</success_criteria>

<user_setup>
</user_setup>
