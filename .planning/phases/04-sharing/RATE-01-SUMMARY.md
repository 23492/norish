---
phase: 04-sharing
plan: RATE-01
subsystem: api
tags: [trpc, drizzle, recipe-ratings, ratings, access-control, isolation, next-intl, react, heroui]

requires:
  - phase: 02-multi-household
    provides: "per-cookbook isolation (canAccessResource by recipe household_id + member household ids; assertRecipeAccess); HOUSE-06 (02-03)"
  - phase: 03-per-cookbook-policies
    provides: "POLICY-01 per-cookbook view policy; assertRecipeAccess resolved against the recipe's OWN cookbook"
provides:
  - "getRecipeRaters(recipeId) repo fn: recipe_ratings INNER JOIN user, decrypted display names (mirrors getUsersByIds), most-recent-first; RecipeRater type"
  - "RecipeRaterSchema + RecipeRatersSchema (shared zod): { recipeId, averageRating, ratingCount, raters[{ userId, name|null, rating, updatedAt }] }"
  - "ratings.getRaters authedProcedure: assertRecipeAccess(view) FIRST (FORBIDDEN for a non-viewer, names never fetched) -> { aggregate + named rater list }"
  - "createUseRecipeRatersQuery shared-react hook (wired into createRatingsHooks) + the web adapter"
  - "RecipeRaters web component (avg+count summary + per-user 'rated by <name> ★★★★' list, current user labelled 'You', null-name fallback) rendered in the rating section of BOTH recipe detail pages (desktop + mobile)"
  - "i18n recipes.detail.{ratingsCount(plural),ratedBy,you,anonymousRater} in all 11 locales (nl+en real, 9 EN-fallback)"
affects: [04-sharing-human-verify, RATE-02, VERSION-01, DINNER-01]

tech-stack:
  added: []
  patterns:
    - "Access-gate-before-read for a derived per-user surface: a NEW read query that exposes member display names runs assertRecipeAccess(view) FIRST, so a user outside the recipe's cookbook gets FORBIDDEN and the rater names are never even queried (no cross-cookbook name leak). Mirrors the recipes getProcedure/permissions-integration boundary; proven adversarially."
    - "Reuse the existing recipe_ratings stack (table + rate/getUserRating/getAverageRating repo + ratings router + StarRating UI + the useRatingQuery that already returns averageRating/ratingCount): RATE-01 ADDED only the rater-list query + a read-only display, nothing was reinvented."
    - "Encrypted display name handled exactly like the household member-name mapping: decrypt(users.name) in the repo with a null fallback for a missing/undecryptable name; the UI falls back to a generic label and labels the current user 'You'."

key-files:
  created:
    - packages/shared-react/src/hooks/ratings/use-recipe-raters-query.ts
    - apps/web/hooks/ratings/use-recipe-raters-query.ts
    - apps/web/components/recipes/recipe-raters.tsx
    - packages/trpc/__tests__/ratings/raters.test.ts
  modified:
    - packages/db/src/repositories/ratings.ts
    - packages/shared/src/contracts/zod/ratings.ts
    - packages/trpc/src/routers/ratings/ratings.ts
    - packages/trpc/__tests__/mocks/ratings-repository.ts
    - packages/shared-react/src/hooks/ratings/index.ts
    - apps/web/hooks/ratings/index.ts
    - "apps/web/app/(app)/recipes/[id]/recipe-page-desktop.tsx"
    - "apps/web/app/(app)/recipes/[id]/recipe-page-mobile.tsx"
    - "packages/i18n/src/messages/<11 locales>/recipes.json"

key-decisions:
  - "Built ON norish's existing per-user recipe_ratings feature. Already present + reused: the recipe_ratings table (unique (user_id, recipe_id), optimistic version), the repo (rateRecipe / getUserRating / getUserRatingWithVersion / getAverageRating -> { averageRating, ratingCount }), the ratings tRPC router (rate / getUserRating / getAverage + the ratingUpdated/ratingFailed subscriptions), the StarRating input + RatingStars UI primitives, the useRatingQuery hook (which ALREADY returns averageRating + ratingCount + userRating), and the dashboard recipe card (which ALREADY shows averageRating via RecipeDashboardSchema). RATE-01 ADDED only (1) the named-rater list and (2) the average+count rendered ON the detail page."
  - "NEW data: getRecipeRaters(recipeId) joins recipe_ratings -> user and returns each rater's decrypted display name + stars + updatedAt, most-recent-first. RecipeRaterSchema/RecipeRatersSchema in the shared ratings zod. No schema change, no migration — recipe_ratings + user already exist."
  - "Access control on the rater list: ratings.getRaters is an authedProcedure that calls `await assertRecipeAccess(ctx, input.recipeId, \"view\")` BEFORE fetching anything, then runs getAverageRating + getRecipeRaters in parallel. assertRecipeAccess resolves the policy + admin from the recipe's OWN cookbook (resolveRecipeCookbookPolicy) and throws TRPCError FORBIDDEN when the caller cannot view — so a user outside the recipe's cookbook can never read its raters' names (HOUSE-06 / POLICY-01 honored). The gate runs first, so the names are never even queried for a non-viewer."
  - "DEFERRED as RATE-02 (privacy decision, FLAGGED for Kiran): showing rater NAMES on the no-auth /share/<token> public view. The public sharedRecipeProcedure + PublicRecipeViewSchema are UNTOUCHED — ratings/names are NOT added to the public surface. Exposing cookbook member names to anonymous visitors is a privacy call Kiran should confirm; RATE-01 is authenticated-views-only as locked."
  - "UI: a single read-only RecipeRaters component renders the aggregate (★ + average.toFixed(1) + a pluralized count) and the per-user 'rated by <name>' list (each with a 5-star read-only row); it sits in the EXISTING rating section (the bg-default-100 box below Steps) of BOTH recipe-page-desktop and recipe-page-mobile, directly under the existing StarRating input. It renders nothing while loading or when ratingCount is 0 (the existing 'What did you think of this recipe?' prompt already covers the empty state). The current viewer's row is labelled 'You'; a missing/undecryptable name falls back to a generic 'A member' label."
  - "Reused the existing createRatingsHooks factory: added createUseRecipeRatersQuery (calls trpc.ratings.getRaters) into the same factory + the web adapter, alongside the existing useRatingQuery/useRatingsMutation/useRatingsSubscription. No new tRPC client wiring."
  - "Pre-existing ratings procedures (rate/getUserRating/getAverage) remain authed-but-not-access-gated (they trust the recipeId); that is upstream behavior and OUT OF SCOPE. Only the NEW getRaters (which exposes member NAMES) gets the assertRecipeAccess gate — the new surface is the one with a privacy/leak dimension."
  - "i18n: 4 keys added to recipes.detail (ratingsCount as an ICU plural, ratedBy with {name}, you, anonymousRater) in all 11 locales — nl + en real, the other 9 EN-fallback (the locked policy); pnpm i18n:check exits 0. The pl/de/es/fr/ko/ru recipes.json got a Prettier-compliant whitespace normalization (inline objects expanded) — prettier --check passes, i.e. it matches the repo's own formatter."

patterns-established:
  - "Access-gate-before-read for any NEW query that surfaces other users' PII (here: member display names) — assertRecipeAccess(view) runs first; the data is never fetched for a forbidden caller; proven by an adversarial weaken->RED->revert."
  - "Decrypt a user display name in a repo read exactly like getUsersByIds / the household member-name mapping, with a null fallback the UI degrades gracefully."

requirements-completed: [RATE-01]

duration: ~50 min
completed: 2026-06-14
---

# Phase 04 Plan RATE-01: Recipe average rating + count + per-user named-rater list (authenticated detail view)

**A recipe's aggregate rating (average + count) and a per-user "rated by <name> ★★★★" list, surfaced on the AUTHENTICATED recipe detail page (desktop + mobile), built ON norish's existing per-user recipe_ratings feature: a NEW getRecipeRaters repo join (decrypted display names) + a NEW ratings.getRaters tRPC query that runs assertRecipeAccess(view) FIRST (so a user outside the recipe's cookbook can never read its raters' names) + a read-only RecipeRaters component in the existing rating section — with public-share-view ratings DEFERRED as RATE-02 (a privacy decision flagged for Kiran).**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 (the human-verify is owned by the lead and was NOT run)
- **Files changed:** 23 (4 created: the shared-react hook, the web adapter, the RecipeRaters component, the raters test)

## What recipe_ratings already provided vs. what RATE-01 added

**Already present (reused, not reinvented):**
- the `recipe_ratings` table (`unique (user_id, recipe_id)`, optimistic `version`, FKs to user + recipe with cascade) and its repo: `rateRecipe`, `getUserRating`, `getUserRatingWithVersion`, and **`getAverageRating` -> `{ averageRating, ratingCount }`**.
- the `ratings` tRPC router (`rate`, `getUserRating`, `getAverage`) + the `ratingUpdated` / `ratingFailed` subscriptions.
- the **`StarRating`** input + **`RatingStars`** UI primitives.
- the **`useRatingQuery`** hook, which **already returns `averageRating` + `ratingCount` + `userRating`**, and the **dashboard recipe card**, which **already shows `averageRating`** (rounded) via `RecipeDashboardSchema` (`averageRating`/`ratingCount` already flow into the DTO — verified).

**Added by RATE-01:**
- **`getRecipeRaters(recipeId)`** — the only NEW data path: `recipe_ratings INNER JOIN user`, decrypted display name (mirrors `getUsersByIds`), most-recent rating first; `RecipeRater` type + `RecipeRaterSchema`/`RecipeRatersSchema` shared zod.
- **`ratings.getRaters`** — a NEW access-gated query returning the aggregate + the named-rater list.
- a read-only **`RecipeRaters`** component rendering the **average + count** and the **named-rater list** in BOTH detail pages' rating section.
- the `createUseRecipeRatersQuery` hook + 4 i18n keys in 11 locales.

## Task Commits

Each task was committed atomically on `feat/phase-2-multi-household`:

1. **Task 1: getRecipeRaters repo + RecipeRaters zod contract** - `ee3408a1` (feat)
2. **Task 2: access-gated ratings.getRaters tRPC query + isolation tests** - `341ddd8a` (feat)
3. **Task 3: recipe detail average+count + named-rater list UI + i18n (11 locales)** - `b900aa84` (feat)

**Plan metadata:** this SUMMARY commit (docs) + the STATE/ROADMAP/REQUIREMENTS update commit (docs).

## Where the average+count and the named-rater list render

Both `apps/web/app/(app)/recipes/[id]/recipe-page-desktop.tsx` and `…/recipe-page-mobile.tsx` already had a rating section (the `bg-default-100` rounded box under Steps, gated on `getShowRatingsPreference(user)`) containing the existing `StarRating` input. RATE-01 adds `<RecipeRaters recipeId={recipe.id} />` directly under that input in BOTH pages. `RecipeRaters`:
- fetches via `useRecipeRatersQuery` (-> `ratings.getRaters`);
- renders the **aggregate**: a star icon + `averageRating.toFixed(1)` + `t("ratingsCount", { count })` (an ICU plural, e.g. "3 ratings");
- renders the **per-user list**: one row per rater — `t("ratedBy", { name })` + a read-only 5-star row for that rater's score. The current viewer is labelled `t("you")` ("You"/"Jij"); a `null` name falls back to `t("anonymousRater")` ("A member"/"Een lid").
- renders **nothing** while loading or when `ratingCount === 0` (the existing "What did you think of this recipe?" prompt already covers the empty state).
The dashboard card's `averageRating` chip is unchanged (it already existed via the DTO).

## Access control on the rater list (the security dimension)

The rater list is the one NEW surface that exposes **other users' display names**, so it is access-gated. `ratings.getRaters` (quoted):

```ts
const getRaters = authedProcedure.input(RatingGetInputSchema).query(async ({ ctx, input }) => {
  await assertRecipeAccess(ctx, input.recipeId, "view");

  const [stats, raters] = await Promise.all([
    getAverageRating(input.recipeId),
    getRecipeRaters(input.recipeId),
  ]);

  return { recipeId: input.recipeId, ...stats, raters };
});
```

`assertRecipeAccess` (reused from `routers/recipes/helpers.ts`) resolves the policy + admin from the **recipe's OWN cookbook** (`resolveRecipeCookbookPolicy`) and throws `TRPCError({ code: "FORBIDDEN" })` when `canAccessResource("view", …)` is false — so **a user who cannot view the recipe can never read its raters' names** (HOUSE-06 / POLICY-01). Because the gate runs FIRST, `getRecipeRaters` is **never even called** for a forbidden caller — no name is queried, let alone returned.

### Access-respecting test result
`packages/trpc/__tests__/ratings/raters.test.ts` exercises the REAL `getRaters` procedure end-to-end against the REAL `assertRecipeAccess` boundary (only the data layer — `getRecipeRaters`/`getAverageRating` + the db functions the boundary calls — is mocked, mirroring the recipes `permissions-integration` test). 5 tests, all green:
- a **member of the recipe's cookbook** (view=household) gets the aggregate + the named list (`["Alice","Bob"]` with stars `[5,4]`);
- a **member of ONLY another cookbook** gets `FORBIDDEN` **and `getRecipeRaters` is never called** (asserted) — no cross-cookbook name leak;
- the **personal view (no membership)** gets `FORBIDDEN` and never reads the raters;
- a `null` rater name surfaces gracefully;
- the rejection is a real `TRPCError` with code `FORBIDDEN`.

**Adversarial (weaken -> RED -> revert, never committed):** changing the gate line to `if (false) await assertRecipeAccess(...)` turned EXACTLY the 3 access-control tests RED (both FORBIDDEN tests + the TRPCError-instance test) while the two happy-path tests stayed green; reverted byte-identical (`git grep -c "if (false)"` -> 0; all 13 ratings tests green again). The weakening was never committed.

## Public-view ratings: DEFERRED as RATE-02 (privacy flag for Kiran)

Per the locked scope, **the no-auth `/share/<token>` public view is UNTOUCHED** — ratings and rater **names are NOT added to the public surface**. The public `sharedRecipeProcedure` and `PublicRecipeViewSchema` are unchanged. Showing cookbook **member names to anonymous visitors** is a privacy decision; flagged as **RATE-02** for Kiran to confirm before any public-share rating display is built. (RATE-01 is authenticated-views-only.)

## Static verification (all GREEN)

- **Typecheck (EXIT 0):** db, shared, auth, trpc, shared-react, **web** — all 6 packages. (trpc/shared-react/auth `typecheck` run `tsc --noCheck`, as on 02-04..SHARE-01; to honor the HARD GATE a real `tsc --noEmit` was also run on trpc + shared-react: **ZERO errors in any touched file** — the only real-tsc errors are the 5 pre-existing, unrelated ones in `@norish/shared-server` (category-matcher.ts, archive/parser.ts) + `@norish/auth` (auth.ts), present on clean HEAD since 02-04. The **web** typecheck is a real `tsc --noEmit` (no `--noCheck`) and is EXIT 0, so the new component + both page edits are fully checked.)
- **Lint (EXIT 0):** db, shared, trpc, shared-react, web — all touched packages clean (0 problems).
- **i18n:check (EXIT 0):** "All locales have complete translations." `prettier --check` on the locale files passes (the output matches the repo's own formatter).

## Test results

- **trpc:** recipes + ratings + households = **109/109** (9 files) — incl. `ratings/raters.test.ts` **5/5** (new), `ratings/ratings.test.ts` 8/8, `recipes/permissions-integration.test.ts` 22/22.
- **db:** `households.isolation.test.ts` **6/6** (HOUSE-06 intact), `recipes.test.ts` 12/12 + `recipe-shares.test.ts` 8/8 (no parse regression from the ratings-repo touch).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The getRaters test went through withAuth, which OVERWRITES ctx.memberHouseholdIds**
- **Found during:** Task 2
- **Issue:** `ratingsProcedures.createCaller(ctx)` runs the full `authedProcedure` chain, and `withAuth` recomputes `ctx.memberHouseholdIds` from `getHouseholdsForUser(user.id)`. The first test draft set `memberHouseholdIds` on the passed-in ctx; the middleware discarded it, so even the cookbook member was treated as a non-member and the happy-path tests went FORBIDDEN.
- **Fix:** drive membership through a per-test `getHouseholdsForUser` mock keyed by userId (mirroring how withAuth actually resolves it) instead of the (discarded) ctx field; added `isUserServerAdmin` to the `@norish/db` mock so the module graph resolves.
- **Verification:** all 5 raters tests pass; the 3 access-control tests still go RED under the adversarial weakening.

**2. [Rule 1 - Bug] Test recipe id had to be a valid v4 UUID**
- **Found during:** Task 2
- **Issue:** `RatingGetInputSchema` uses `z.uuid()` (strict v1-8 + RFC variant). The first `RECIPE_ID` literal failed input validation before reaching the gate.
- **Fix:** used a valid v4 UUID literal (`a1111111-1111-4111-8111-111111111111`).
- **Verification:** input validation passes; tests green.

---

**Total deviations:** 2 (both test-only bug fixes). **Impact:** test correctness only; no production-behavior change. No scope creep — public-view ratings remain deferred (RATE-02).

## Issues Encountered

### Filtered typechecks use --noCheck (pre-existing, same as 02-04..SHARE-01)
The trpc/shared-react/auth `typecheck` scripts run `tsc --noCheck` (EXIT 0). To honor the HARD GATE a real `tsc --noEmit` was also run on trpc + shared-react and grepped to the touched files: ZERO errors in `routers/ratings/ratings.ts` or `hooks/ratings/use-recipe-raters-query.ts` / `hooks/ratings/index.ts`. The only real-tsc errors are the 5 pre-existing unrelated ones (shared-server + auth) documented since 02-04. The web typecheck is a real `tsc --noEmit` and is EXIT 0.

### i18n whitespace normalization in 6 locale files
Writing the locale JSON with `JSON.stringify(…, 2)` expanded a few pre-existing inline objects (e.g. pl `timeInputs`/`ingredientInput`) to multi-line. `prettier --check` on the locale files PASSES — the output is exactly what the repo's own formatter produces — so this is tooling-consistent, not drift. The substantive change in every locale is the same 4 keys appended after `ratingPrompt`.

## User Setup Required

None - no external service configuration (no migration; recipe_ratings + user already exist).

## Human-Verify: PENDING (lead - Chrome)

The checkpoint:human-verify was NOT run (owned by the lead). The lead rebuilds `norish:local` on LXC 110, recreates the `norishp2` verify stack, and verifies in Chrome:
1. Open a recipe you can view -> rate it with the star input -> the rating section now shows the **average + count** ("★ 4.x · N ratings") and a **"Rated by …"** list including **your name shown as "You"** with your stars.
2. Have a second cookbook member rate it -> their **display name + stars** appear in the list (and the average + count update).
3. Confirm the Dutch strings render ("Beoordeeld door …", "Jij", "# beoordelingen").
4. (Isolation) A user who is NOT a member of the recipe's cookbook cannot reach the recipe detail at all (existing POLICY-01 behavior); the rater list is only ever shown to a viewer.
5. Confirm the public `/share/<token>` view still shows **NO** ratings/names (RATE-02 deferred).

Static verification is all green (see Self-Check).

## Next Phase Readiness

RATE-01 is code-complete (authenticated views). **RATE-02** (public-share-view ratings — a privacy decision: exposing member names to anonymous visitors) is flagged for Kiran to confirm. The rater-list data (names + stars + updatedAt) is also forward-useful for **DINNER-01** (rater avatar + stars) and **VERSION-01** (reviews attributed across versions).

## Self-Check: PASSED

Re-ran every task's acceptance criteria + the plan-level verification:
- **Task 1:** `getRecipeRaters` joins recipe_ratings -> user, decrypts the name (null fallback), orders most-recent-first; `RecipeRaterSchema`/`RecipeRatersSchema` present; db + shared typecheck EXIT 0; db recipe + recipe-shares suites green (no parse regression). PASS
- **Task 2:** `ratings.getRaters` calls `assertRecipeAccess(view)` BEFORE fetching; returns `{ recipeId, averageRating, ratingCount, raters }`; trpc typecheck EXIT 0 + real-tsc ZERO errors in the touched file; trpc lint clean; raters test 5/5; the 3 access-control tests adversarially RED-when-weakened then reverted byte-identical (never committed). PASS
- **Task 3:** `RecipeRaters` rendered in BOTH detail pages' rating section; the avg+count + named list render with the 'You'/null-name fallbacks; recipes.detail.{ratingsCount,ratedBy,you,anonymousRater} in all 11 locales; i18n:check EXIT 0; web typecheck (real tsc) + shared-react typecheck EXIT 0; web + shared-react lint clean. PASS
- **Plan verification:** typecheck db/shared/auth/trpc/shared-react/web all EXIT 0; i18n:check EXIT 0; lint db/shared/trpc/shared-react/web clean; tests: trpc recipes+ratings+households 109/109, db households.isolation 6/6 + recipe 12/12 + recipe-shares 8/8. The rater list is access-gated (FORBIDDEN for a non-viewer, names never fetched); public-view ratings deferred (RATE-02); HOUSE-06 intact. PASS

key-files.created exist on disk; `git log --grep=RATE-01` shows 3 commits. Live containers (norish-app/db/redis) untouched; nothing pushed; no pnpm build/docker:build/dev-server run. No migration (recipe_ratings + user already exist).

---
*Phase: 04-sharing*
*Completed: 2026-06-14*
