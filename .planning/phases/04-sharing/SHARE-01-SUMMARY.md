---
phase: 04-sharing
plan: SHARE-01
subsystem: api
tags: [trpc, drizzle, recipe-shares, visibility, public-endpoint, isolation, next-intl, react, heroui]

requires:
  - phase: 02-multi-household
    provides: "per-cookbook isolation (canAccessResource by recipe household_id + member household ids; buildViewPolicyCondition); HOUSE-06 (02-03)"
  - phase: 03-per-cookbook-policies
    provides: "POLICY-01 per-cookbook view/edit/delete; assertRecipeAccess resolved against the recipe's OWN cookbook (edit = owner OR cookbook admin)"
provides:
  - "recipes.visibility enum column (private | household | public; NOT NULL default 'private') + migration 0038_lean_sauron (CREATE TYPE recipe_visibility + ADD COLUMN, existing rows backfill to private)"
  - "RecipeVisibilitySchema/recipeVisibilities (shared zod) + RecipeVisibility DTO; visibility carried through FullRecipeSchema + getRecipeFull, OMITTED from RecipeDashboardSchema (no 02-06 createSelectSchema regression)"
  - "Repo: getRecipeVisibility / setRecipeVisibility (optimistic version) / countActiveRecipeShares (active = not revoked, not expired) on recipes repo"
  - "Public-route visibility GATE in sharedRecipeProcedure (recipe.visibility !== 'public' -> opaque NOT_FOUND) + a repo-level belt-and-suspenders gate in getPublicRecipeView"
  - "shareCreate promotes the recipe to public; shareRevoke/shareDelete revert to private when no active share remains"
  - "recipes.shareSetVisibility authedProcedure (assertRecipeAccess edit; emits the existing recipe `updated` event) + SetRecipeVisibilityInputSchema / RecipeVisibilityResultSchema"
  - "Share token standardized to crypto.randomBytes(32).toString('base64url') (was 24)"
  - "Recipe Share panel Visibility select (private/household/public) + helper, wired to shareSetVisibility; i18n recipes.sharePanel.visibility.* in all 11 locales (nl+en real, 9 EN-fallback)"
affects: [04-sharing-human-verify, SHARE-02]

tech-stack:
  added: []
  patterns:
    - "Visibility-as-gate, share-token-as-capability: the recipe's explicit `visibility` is the boundary the public route enforces; the long share token is the capability. The public surface requires BOTH (active token AND visibility=public)."
    - "Single public-surface choke point: sharedRecipeProcedure resolves token->share->recipe then enforces visibility=public with the SAME opaque NOT_FOUND as a missing/expired/revoked token (no enumeration). Covers getShared + sharePublicConfig + any future shared procedure. A repo-level gate in getPublicRecipeView makes the helper safe on its own (defense in depth)."
    - "Additive enum column without a real-row-parse regression: a NOT NULL column on `recipes` makes createSelectSchema(recipes) require it -> carry it through FullRecipeSchema + getRecipeFull's columns+dto (the detail view needs it) and OMIT it from RecipeDashboardSchema (the dashboard/list mappers don't supply it). Mirrors the 02-06 omit fix."
    - "Visibility transitions live in the share router (markRecipePublic on create; revertRecipePrivateIfNoActiveShares on revoke/delete), each tolerant of a concurrent version bump via a single re-read."

key-files:
  created:
    - packages/db/src/migrations/0038_lean_sauron.sql
    - packages/db/src/migrations/meta/0038_snapshot.json
  modified:
    - packages/db/src/schema/recipes.ts
    - packages/shared/src/contracts/zod/recipe.ts
    - packages/shared/src/contracts/dto/recipe.d.ts
    - packages/db/src/repositories/recipes.ts
    - packages/db/src/repositories/recipe-shares.ts
    - packages/trpc/src/middleware.ts
    - packages/trpc/src/routers/recipes/shares.ts
    - "apps/web/app/(app)/recipes/[id]/components/recipe-share-panel.tsx"
    - "packages/i18n/src/messages/<11 locales>/recipes.json"
    - packages/trpc/__tests__/recipes/shares.test.ts
    - packages/trpc/__tests__/recipes/test-utils.ts
    - packages/db/__tests__/server/db/repositories/recipe-shares.test.ts
    - packages/db/src/migrations/meta/_journal.json

key-decisions:
  - "Built ON the existing recipe_shares feature (table + repo + recipes.shares router + sharedRecipeProcedure + the public /share/[token] page + media routes + the recipe Share panel + admin/user share-link cards), which already delivered tokenized, hashed-at-rest, status-gated (active/expired/revoked), single-recipe read-only public viewing. SHARE-01 ADDED only the explicit per-recipe visibility level + its gate; nothing was reinvented."
  - "Visibility model: recipes.visibility enum private (default) | household | public. private/household follow the per-cookbook policy (POLICY-01); public is the ONLY level reachable by the no-auth /share/<token> route. The token alone is no longer sufficient: the public route also requires visibility=public."
  - "PUBLIC endpoint data shape is UNCHANGED and single-recipe-only: PublicRecipeViewSchema = { name, description, notes, url, image, servings, prepMinutes, cookMinutes, totalMinutes, systemUsed, calories, fat, carbs, protein, categories, tags, recipeIngredients, steps, author{name,image}, images, videos }. NEVER id/userId/householdId/ownerId/tokenHash, member lists, cookbook contents, or other recipes. Media URLs are rewritten to /share/<token>/... so they leak no recipe id."
  - "Public route is /share/<token> (the existing route; RecipeShareCreatedSchema.url starts with /share/). No new public route was introduced. No public gallery/discovery (deferred)."
  - "Who can share / set visibility: assertRecipeAccess(ctx, recipeId, 'edit') -> owner OR the recipe's cookbook admin (POLICY-01), resolved against the recipe's OWN cookbook. Sharing sits ON TOP of the per-cookbook boundary and never widens cross-cookbook access (HOUSE-06 intact)."
  - "Visibility auto-transitions: creating a share link promotes the recipe to public; revoking/deleting the LAST active share returns it to private (a recipe with no live public link is not publicly reachable). Visibility is also directly settable via shareSetVisibility."
  - "Token standardized to crypto.randomBytes(32).toString('base64url') (~43 chars), matching the 02-06 invite-token strength (was randomBytes(24)). Still hashed at rest (token_hash, unique); the raw token is returned once at creation only."
  - "SHARE-02 (save-to-account) is OUT OF SCOPE and deferred to the next cycle, as locked."
  - "Regression-proofed the new column: visibility carried through FullRecipeSchema + getRecipeFull (columns + dto) and omitted from RecipeDashboardSchema, so getRecipeFull/getRecipeByUrl/dashboardRecipe/listRecipes all keep parsing real rows (the 02-06 createSelectSchema class). Verified by a real-Postgres parse test."
  - "Planning placement: artifacts under .planning/phases/04-sharing/ with commits scoped (SHARE-01). AssemblyAI (formerly Phase 4) is renumbered to Phase 5 in the ROADMAP/REQUIREMENTS to make room for the Sharing phase."

patterns-established:
  - "Visibility-as-gate + token-as-capability for a public read-only resource; the public procedure enforces both with an opaque NOT_FOUND."
  - "Adding a NOT NULL enum column to a heavily-derived table (recipes) without breaking any real-row safeParse: carry-through where needed, omit where the mapper doesn't supply it."

requirements-completed: [SHARE-01]

duration: ~55 min
completed: 2026-06-14
---

# Phase 04 Plan SHARE-01: Per-recipe visibility (private/household/public) on the existing share-link feature

**A per-recipe visibility level (private default | household | public) layered onto norish's existing tokenized recipe_shares feature: the no-auth /share/<token> route now serves a recipe ONLY when its visibility is `public` (private/household are unreachable via the public route even with a valid token), creating a share link promotes the recipe to public + revoking the last one reverts it to private, an editor can set visibility from the recipe Share panel, and the share token is standardized to crypto.randomBytes(32) — all enforced ON TOP of POLICY-01/HOUSE-06 with no cross-cookbook leak.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 5 (the human-verify is owned by the lead and was NOT run)
- **Files modified:** 15 (2 created: migration 0038 SQL + snapshot)

## What the existing recipe_shares gave us vs. what SHARE-01 added

**Already present (reused, not reinvented):** the `recipe_shares` table (token_hash hashed at rest, unique; expiresAt/revokedAt/lastAccessedAt; optimistic version), the full repo (`createRecipeShare`, `getActiveRecipeShareByToken` with status gating, `getPublicRecipeView` + `mapRecipeToPublicRecipeView` producing a sanitized single-recipe DTO, revoke/reactivate/delete with MutationOutcome), the `recipes.shares` tRPC router (`shareCreate` gated on `assertRecipeAccess edit`, list/get/update/revoke/reactivate/delete, `getShared` + `sharePublicConfig` on a PUBLIC `sharedRecipeProcedure`), the public `/share/[token]` page + its `media/`+`steps/` routes + proxy handling, the recipe Share panel, and admin/user share-link settings cards.

**Added by SHARE-01:** the explicit `recipes.visibility` enum + migration 0038; the **visibility gate** on the public route (the boundary that makes private/household recipes unreachable publicly); the create->public / revoke-last->private transitions; a `shareSetVisibility` procedure + the panel control; the 32-byte token bump; and the security/real-parse/isolation tests.

## Task Commits

1. **Task 1: schema + zod + migration 0038** - `4a8349f3` (feat)
2. **Task 2: repo visibility setters + 32-byte token + repo public gate** - `5fdfcfa7` (feat)
3. **Task 3: public-route visibility gate + setVisibility procedure + create/revoke transitions** - `a35a909c` (feat)
4. **Task 4: Share panel visibility control + i18n (11 locales)** - `07fd4e85` (feat)
5. **Task 5: adversarial gate + real-parse + isolation tests** - `bfb679e3` (test)

**Plan metadata:** this SUMMARY commit (docs) + the STATE/ROADMAP/REQUIREMENTS update commit (docs).

## The public-endpoint security model

- **Single choke point.** `sharedRecipeProcedure` (publicProcedure, no auth) resolves `token -> active share -> getRecipeFull(recipeId)` then enforces `recipe.visibility !== "public" -> throw NOT_FOUND`, the SAME opaque error as a missing/expired/revoked token. A probe cannot distinguish "no such token" from "not public" (no enumeration). This covers `getShared`, `sharePublicConfig`, and any future shared procedure.
- **Defense in depth.** `getPublicRecipeView` independently returns `null` unless `visibility === "public"`, so the repo helper is safe even if called outside the middleware.
- **Exact public data shape (single-recipe display only; quoted):** `PublicRecipeViewSchema = { name, description, notes, url, image, servings, prepMinutes, cookMinutes, totalMinutes, systemUsed, calories, fat, carbs, protein, categories, tags[{name}], recipeIngredients[{ingredientName,amount,unit,systemUsed,order}], steps[{step,systemUsed,order,images}], author{name,image}, images, videos }`. It NEVER carries `id`/`userId`/`householdId`/`ownerId`/`tokenHash`, member lists, cookbook contents, or any other recipe. Media URLs are rewritten to `/share/<token>/media|steps/...` so no recipe id leaks. A tRPC test asserts the returned object has no `id`/`userId`/`householdId`/`tokenHash` and `author` has no `id`.

### Adversarial result (weaken -> RED -> revert, never committed)
- **Middleware gate:** changing `if (recipe.visibility !== "public")` to `if (false && ...)` turned EXACTLY the two tRPC tests "does NOT serve a PRIVATE recipe via the public token route" and "does NOT serve a HOUSEHOLD recipe via the public token route" RED. Reverted byte-identical (git diff vs the committed Task-3 version is empty); the weakening was never committed.
- **Repo gate:** the same `false &&` weakening of `getPublicRecipeView` turned the db test "does NOT build a public view for a private or household recipe" RED. Reverted byte-identical; never committed.

### Real-Postgres parse test (the 02-06 lesson)
`packages/db/__tests__/server/db/repositories/recipe-shares.test.ts` exercises the REAL `getRecipeFull` against a real row: a default recipe round-trips `visibility === "private"` and a public one round-trips `"public"` with NO "Failed to parse FullRecipeDTO" (which a NOT NULL column would otherwise trigger via createSelectSchema). The pre-existing recipe + dashboard suites (`recipes.test.ts` 12/12, recipe zod 8/8) confirm `dashboardRecipe`/`listRecipes` (the omit path) still parse. The trpc suite mocks `@norish/db` wholesale, so the real-parse coverage lives in the db suite (testcontainers).

## How sharing respects POLICY-01 / isolation
- Creating/revoking a link and `shareSetVisibility` all go through `assertRecipeAccess(ctx, recipeId, "edit")`, which resolves the policy + admin from the recipe's OWN cookbook (`resolveRecipeCookbookPolicy`) — `edit = household` => recipe owner OR that cookbook's admin (POLICY-01 admin-edits-any / members-edit-own). Visibility is a per-recipe opt-in that sits ON TOP of the policy; it never grants cross-cookbook visibility. `getPublicRecipeView` serves a single recipe by id; it does not list a cookbook. The db `households.isolation` suite (HOUSE-06) stays 6/6.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Re-linked broken node_modules hardlink twins**
- **Found during:** Tasks 2-3 (db typecheck failed: `FullRecipeDTO` lacked `visibility`)
- **Issue:** the CLAUDE.md gotcha — `packages/shared/src/contracts/zod/recipe.ts`, `packages/db/src/schema/recipes.ts`, `packages/db/src/repositories/recipes.ts`, and `packages/trpc/src/middleware.ts` had node_modules twins on a DIFFERENT inode (broken by prior git checkouts), so downstream typechecks read stale copies without the new column/schema.
- **Fix:** `rm` + `ln` to re-establish each hardlink (same inode, link count 2). Re-applied after edits to these files (redit.py writes can re-break the inode).
- **Files modified:** none in git (node_modules is gitignored; environment re-sync).
- **Verification:** matching inodes confirmed; db/trpc/web typechecks EXIT 0.

**2. [Rule 1 - Bug] Test fixtures needed visibility after the schema change**
- **Found during:** Task 5
- **Issue:** `createMockFullRecipe` (trpc test-utils) didn't set `visibility` (now required on FullRecipeDTO), and the existing db "builds a sanitized public recipe view" test created a default (private) recipe, which the new repo gate now returns null for.
- **Fix:** added `visibility: "public"` as the default in `createMockFullRecipe`; set the recipe to public in the existing db public-view test before asserting it is served. Both are precondition updates the new gate requires, not behavior changes.
- **Verification:** trpc shares 17/17, db recipe-shares 8/8.

**3. [Rule 1 - Bug] FORBIDDEN test needed a real TRPCError**
- **Found during:** Task 5
- **Issue:** mocking `assertRecipeAccess` to reject with a plain `Error` + ad-hoc `code` made tRPC wrap it as INTERNAL_SERVER_ERROR; the test expected FORBIDDEN.
- **Fix:** the mock now rejects with a real `new TRPCError({ code: "FORBIDDEN" })` (what the real `assertRecipeAccess` throws). Added the `@trpc/server` import to the test.
- **Verification:** the setVisibility-edit-gate test passes.

---

**Total deviations:** 3 (1 blocking env re-link, 2 test-fixture bug fixes). **Impact:** all necessary; no scope creep, no production-behavior change beyond the plan. No public gallery, no save-to-account, no cross-cookbook grant.

## Issues Encountered

### Filtered typechecks use --noCheck (pre-existing, same as 02-04/02-05/02-06)
The trpc/shared-react `typecheck` scripts run `tsc --noCheck` and are EXIT 0. To honor the HARD GATE I also ran a real `tsc --noEmit` on @norish/trpc and grepped my touched files (middleware.ts, routers/recipes/shares.ts): ZERO errors in any touched file. The only real-tsc errors are the 5 pre-existing, unrelated ones in `@norish/shared-server` (category-matcher.ts, archive/parser.ts) and `@norish/auth` (auth.ts), present on clean HEAD since 02-04. The web typecheck is a real `tsc --noEmit` (no --noCheck) and is EXIT 0, so the panel changes are fully checked.

### Broad `pnpm --filter @norish/db test` is flaky under parallel testcontainers
Running the whole db suite at once intermittently shows a `terminating connection due to administrator command` teardown error + the 3 known-pre-existing `updateRecipeWithRefs` unit-normalization failures (documented in STATE, out of scope). Running the targeted recipe/share/isolation files is clean and deterministic. SHARE-01 added no flakiness.

## User Setup Required

None - no external service configuration (user_setup: []). Migration 0038 applies at boot.

## Human-Verify: PENDING (lead - Chrome)

The checkpoint:human-verify was NOT run (owned by the lead). The lead rebuilds norish:local on LXC 110, recreates the norishp2 verify stack (applies migration 0038 at boot), and re-verifies in Chrome:
1. Open a recipe -> Share panel -> set Visibility = Public -> create a share link -> copy the URL.
2. Open `/share/<token>` in a logged-OUT context -> ONLY that one recipe renders (read-only); no other recipes/owner data/cookbook listing.
3. Set the recipe back to Private (or revoke the last link) -> re-open `/share/<token>` -> it is NOT viewable (NOT_FOUND), confirming a private recipe's link is not publicly reachable.
4. Confirm the Dutch visibility strings render.

Static verification is all green (see Self-Check).

## Next Phase Readiness

SHARE-01 is code-complete. SHARE-02 (save-to-account on a shared/public recipe) is the natural follow-up and is explicitly deferred. After the lead's Chrome re-verify (incl. migration-0038-at-boot), the Sharing phase's first plan is shippable.

## Self-Check: PASSED

Re-ran every task acceptance_criteria + the plan-level verification:
- **Task 1:** schema has recipe_visibility enum + visibility column; migration 0038_lean_sauron has CREATE TYPE + ADD COLUMN DEFAULT 'private' NOT NULL; RecipeVisibilitySchema/recipeVisibilities present; dashboard omits visibility; getRecipeFull carries it; db + shared typecheck EXIT 0; db recipe + recipe-shares suites green (real-parse). PASS
- **Task 2:** randomBytes(32) present; getRecipeVisibility/setRecipeVisibility/countActiveRecipeShares present; getPublicRecipeView null for non-public; db typecheck EXIT 0. PASS
- **Task 3:** sharedRecipeProcedure throws NOT_FOUND when visibility !== public; shareSetVisibility wired into recipeSharesProcedures; create->public, revoke/delete->private-when-empty; trpc + shared typecheck EXIT 0; trpc lint clean; real-tsc zero errors in touched files. PASS
- **Task 4:** Share panel has the Visibility control; recipes.sharePanel.visibility.* in all 11 locales; i18n:check EXIT 0; web + shared-react typecheck EXIT 0; web panel lint clean. PASS
- **Task 5:** new tests pass (trpc shares 17/17, db recipe-shares 8/8); households.isolation 6/6; BOTH gates adversarially RED-when-weakened then reverted byte-identical (never committed). PASS
- **Plan verification:** typecheck db/shared/auth/trpc/shared-react/web all EXIT 0; i18n:check EXIT 0; lint db/shared/trpc/web(panel) clean (0 errors); tests: trpc recipes+households 96/96 (7 files), db recipe+share+isolation+zod 34/34 (4 files), auth 99/99. The PUBLIC route returns ONLY PublicRecipeViewSchema for a public recipe and NOT_FOUND for private/household; sharing rides on assertRecipeAccess edit + POLICY-01; HOUSE-06 intact. PASS

key-files.created exist on disk; git log --grep=SHARE-01 shows 5 commits. Live containers (norish-app/db/redis) untouched; nothing pushed; no pnpm build/docker:build/dev-server run. Migration 0038 applies at boot - to be confirmed by the lead's rebuild + norishp2 recreate.

---
*Phase: 04-sharing*
*Completed: 2026-06-14*
