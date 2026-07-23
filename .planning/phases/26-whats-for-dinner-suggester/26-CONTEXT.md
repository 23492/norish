# Phase 26: What's-for-dinner suggester — Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Requirement:** DINNER-01 (source: ROADMAP — the cheapest "feels like a product" win)

<domain>
## Phase Boundary

Suggest tonight's recipe from the viewer's ACCESSIBLE recipes, weighted by SEASON
(derived from the recipe's own tags) + RECENT RATINGS (the shipped `recipe_ratings`),
presented with the rater's avatar, stars and a thought-bubble. Builds ENTIRELY on the
shipped `recipe_ratings` + tags surface — NO new data source, NO new provider, NO new
table, NO migration (DB stays at 41).

In scope:
1. A per-cookbook-scoped candidate query — reuses `buildViewPolicyCondition` wholesale.
2. A pure, deterministic ranking (season lexicon over tags + recent household ratings).
3. A dashboard suggestion card (desktop + mobile web) with the rater avatar/stars/bubble,
   composed from the ALREADY-gated `ratings.getRaters` (RATE-01).

Out of scope: `apps/mobile` (Expo) — "mobile" = the web app's mobile layout, consistent
with prior phases. No AI/provider. No schema change.
</domain>

<decisions>
## Decisions (recorded)

### D-26-01 — Candidate scoping is INHERITED, never re-derived
`getDinnerSuggestionCandidates(ctx)` reuses the SAME `buildViewPolicyCondition` that
`listRecipes` / `getRandomRecipeCandidates` use, so the HOUSE-06 per-cookbook boundary is
inherited. A viewer never gets another cookbook's recipe as a candidate, INCLUDING under
the live `view: "everyone"` policy (the active-cookbook branch clamps to the active
cookbook). This is the one security-critical property; still proven with a suggester-level
isolation test (the recommended-reuse rule from the brief).

### D-26-02 — Season is derived from the recipe's OWN tags, not a new data source
`deriveSeason(date)` maps the current month to a northern-hemisphere season (NL-primary
audience). A bilingual (EN + NL) keyword lexicon is matched (case-insensitive substring)
against each candidate's tag names. No season table, no season column — the signal lives
entirely in the existing tags surface. Recipes with no seasonal tag simply get no season
bonus and fall back to rating-based ranking, so the suggester DEGRADES GRACEFULLY and never
returns empty when candidates exist (answers the "no usable season signal" scope question:
the tags surface CAN carry seasonal tags; when it doesn't, ranking is rating-only).

### D-26-03 — Recent ratings = household-scoped average + count + last-rated recency
The candidate query returns the household-scoped `recipe_ratings` aggregate (avg + count,
mirroring `getRandomRecipeCandidates`) plus `max(updatedAt)` as `lastRatedAt`. The scorer
favours highly-rated recipes ((avg − 3) × 0.5), adds a small popularity term, and boosts
recipes rated within the last 30 days (linear decay).

### D-26-04 — Deterministic, testable, date-seeded variety
Ranking is a PURE function of `(candidates, now, count)`. A per-day jitter seeded from
`hash(recipeId + dateKey)` rotates otherwise-tied recipes day-to-day (so the suggestion
feels alive) WITHOUT `Math.random()` — same inputs → same order, which the tests pin. (App
code; the no-`Math.random()`/`Date.now()` rule is workflow-only.)

### D-26-05 — Rater path stays RATE-01-gated; the suggester never fetches names
The card's avatar/stars/thought-bubble come from the EXISTING `ratings.getRaters`
procedure, which runs `assertRecipeAccess(view)` FIRST. The suggester adds NO new
name-fetching path, so a non-viewer never gets rater names — the gate is inherited and
already covered by `packages/trpc/__tests__/ratings/raters.test.ts`.

### D-26-06 — Placement: the dashboard/home, under Today's meals
`<DinnerSuggestion />` renders on `apps/web/app/(app)/page.tsx` between `TodaysMeals` and
the recipe library — the natural "what now?" slot. Renders nothing on an empty library.
"Another idea" cycles the returned set client-side (no refetch).

### D-26-07 — No schema change / no migration
Reads only existing tables (`recipes`, `recipe_tags`/`tags`, `recipe_ratings`). DB stays at
migration 41. Code-only deploy.
</decisions>

<security>
## Security — HOUSE-06 is INVARIANT

The suggester's candidate set for a viewer in cookbook A NEVER includes cookbook B's
recipes, INCLUDING under a live `view: "everyone"` policy (seed the `everyone` sibling).
The rater path stays RATE-01-gated (a non-viewer never gets rater names).

Adversarial (tests-first spirit; seed the LIVE `everyone` policy as a sibling of
`household` per the AGENTS.md rule):
1. U active on A gets A's recipes as candidates but NOT B's — `household` AND `everyone`.
2. Personal view (no active cookbook) excludes another cookbook's recipe AND another user's
   personal recipe under `everyone`; still surfaces the viewer's own + orphans.
3. Revert-check: drop the per-cookbook predicate in `getDinnerSuggestionCandidates` → the
   isolation suite goes RED → revert byte-identical. Recorded in 26-VALIDATION.md.
</security>

<files>
## Files (map)

**Backend (Plan 26-01)**
- `packages/shared-server/src/recipes/dinner-suggester.ts` (new) — pure `deriveSeason` /
  `matchesSeason` / `scoreDinnerCandidate` / `selectDinnerSuggestions` + the season lexicon.
- `packages/shared-server/package.json` — export map entry for the new module.
- `packages/db/src/repositories/recipes.ts` — `getDinnerSuggestionCandidates(ctx)` +
  `DinnerSuggestionCandidate` (scoped via `buildViewPolicyCondition`).
- `packages/trpc/src/routers/recipes/recipes-openapi-types.ts` — `dinnerSuggestionInputSchema`.
- `packages/trpc/src/routers/recipes/recipes.ts` — `dinnerSuggestion` query procedure.
- Tests: `packages/shared-server/__tests__/recipes/dinner-suggester.test.ts` (pure) +
  `packages/db/__tests__/server/db/repositories/dinner-suggester.isolation.test.ts`.

**Frontend (Plan 26-02)**
- `packages/shared-react/src/hooks/recipes/dashboard/use-dinner-suggestion.ts` (new) +
  wired into `dashboard/index.ts` (factory).
- `apps/web/hooks/recipes/use-dinner-suggestion.ts` (new) + `apps/web/hooks/recipes/index.ts`.
- `apps/web/components/dashboard/dinner-suggestion.tsx` (new) — the card + rater bubble.
- `apps/web/app/(app)/page.tsx` — render the card.
- `packages/i18n/src/messages/<locale>/recipes.json` — `dinner.*` keys in ALL 12 locales.
</files>

---
*Phase: 26-whats-for-dinner-suggester — Context gathered 2026-07-24*
