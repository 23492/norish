# 26-01 SUMMARY — Dinner suggester: scoped candidates + pure ranking (DINNER-01, backend)

**Requirement:** DINNER-01 (backend half)
**DB:** none — reads only existing tables; DB stays at migration 41.

## What shipped

### Pure ranking — `packages/shared-server/src/recipes/dinner-suggester.ts` (new)
- `DinnerCandidate` / `DinnerSuggestion` types; `Season` union.
- `deriveSeason(date)` — northern-hemisphere meteorological season from the month.
- `matchesSeason(tags, season)` — case-insensitive substring match of tag names against a
  bilingual (EN + NL) `SEASON_KEYWORDS` lexicon (kept in-module — the season signal lives
  entirely in the existing tags surface, no new data source).
- `scoreDinnerCandidate` — base 1.0 + season bonus (+1.5) + rating quality ((avg−3)×0.5) +
  popularity (min(count×0.1, 0.5)) + recency (30-day linear-decay, +0.8 max) + a per-day
  jitter seeded from `hash(recipeId + dayKey)`. Score floor 0.05 keeps every candidate
  eligible (never returns empty when candidates exist).
- `selectDinnerSuggestions(candidates, { now, count })` — PURE + deterministic: sort by
  score desc, tiebreak by id, slice `count`. No `Math.random()`.
- `packages/shared-server/package.json` — export-map entry `./recipes/dinner-suggester`.

### Scoped candidate query — `packages/db/src/repositories/recipes.ts`
- `getDinnerSuggestionCandidates(ctx, limit=200)` + `DinnerSuggestionCandidate`. Mirrors
  `getRandomRecipeCandidates`: reuses `buildViewPolicyCondition(ctx)` WHOLESALE (HOUSE-06
  inherited), returns each accessible recipe with its OWN tags + the household-scoped
  `recipe_ratings` aggregate (`avg`, `count`, `max(updatedAt)` as `lastRatedAt`). Auto-
  exported via `@norish/db`.

### tRPC procedure — `packages/trpc/src/routers/recipes/`
- `dinnerSuggestionInputSchema` (`count` 1–10, default 3) in `recipes-openapi-types.ts`.
- `dinnerSuggestion` query in `recipes.ts`: builds `RecipeListContext`, scoped candidates →
  `selectDinnerSuggestions({ now: new Date(), count })`, returns `{ suggestions }`.
  Registered in `recipesProcedures`. No new emit site; no openapi meta (internal query).

### Tests
- `packages/shared-server/__tests__/recipes/dinner-suggester.test.ts` — 11 tests: season
  map, EN/NL lexicon, scoring order (season/rating/recency), floor, determinism, count.
- `packages/db/__tests__/server/db/repositories/dinner-suggester.isolation.test.ts` — 6
  tests: HOUSE-06 A-not-B, personal-view exclusion, the LIVE `everyone` sibling, plus a
  tags + household-rating-aggregate smoke.

## Gates
typecheck 17/17 · shared-server dinner-suggester 11/11 · db dinner isolation 6/6 (`sg docker`) ·
trpc 294/294 (`sg docker`). Security revert-check RED-then-reverted byte-identical
(`26-VALIDATION.md` §3). NO migration.

## Notes
- Season degrades gracefully: a recipe with no seasonal tag simply loses the season bonus and
  ranks on ratings — so DINNER-01 is not blocked by whether real tag data carries season tags.
- Hoisted-linker: the new shared-server module + its `package.json` export had to be re-synced
  into the root-owned `node_modules/@norish/shared-server` copy before the trpc suite resolved
  it (see 26-VALIDATION.md §5).
