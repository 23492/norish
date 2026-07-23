# 26-02 SUMMARY — Dinner suggester: dashboard card + rater bubble + i18n (DINNER-01, frontend)

**Requirement:** DINNER-01 (frontend half)
**DB:** none.

## What shipped

### Hook — `packages/shared-react/src/hooks/recipes/dashboard/use-dinner-suggestion.ts` (new)
- `createUseDinnerSuggestion` — `useQuery` on `recipes.dinnerSuggestion` returning
  `{ suggestions, isLoading, refetch }`; `DinnerSuggestion` / `DinnerSuggestionResult` types.
- Wired into `createDashboardRecipeHooks` (`dashboard/index.ts`) + type re-exports.
- `apps/web/hooks/recipes/use-dinner-suggestion.ts` (new) re-exports it via
  `sharedDashboardRecipeHooks`; added to `apps/web/hooks/recipes/index.ts`.

### Card — `apps/web/components/dashboard/dinner-suggestion.tsx` (new)
- Headline suggestion card: image, season chip (`{season} pick`, only when the recipe's tags
  matched), average-rating star chip, name.
- `RaterThoughtBubble` — reuses `useRecipeRatersQuery` (the RATE-01-gated `ratings.getRaters`)
  + `UserAvatar` + a static-star row; shows the most-recent enthusiastic (≥4★) rater as an
  avatar + "{name} rated this" + their stars. A non-viewer gets no raters → renders nothing.
- "Another idea" cycles the returned set client-side (no refetch). Renders nothing when there
  is no candidate (empty library) or `showRatings` is off (bubble only).
- Respects `getShowRatingsPreference(user)` like the recipe card.

### Placement — `apps/web/app/(app)/page.tsx`
- `<DinnerSuggestion />` rendered under `<TodaysMeals />`, above the recipe library — the
  natural "what now?" slot. Desktop + mobile (responsive card).

### i18n — `packages/i18n/src/messages/<locale>/recipes.json`
- New `recipes.dinner.*` block (`title`, `anotherIdea`, `seasonalPick`, `openRecipe`,
  `raterThought`, `seasons.{spring,summer,autumn,winter}`) in ALL 12 locales, translated
  (incl. `no` so no NEW gap is introduced).

## Gates
typecheck 17/17 · web 424/424 · shared-react 37/37 · lint 0-errors · web build EXIT 0 ·
`i18n:check` EXIT 1 SOLELY on the pre-existing `no` gap (68 keys; zero new gaps).

## Notes
- Hoisted-linker: `node_modules/@norish/shared-react` is a root-owned SEPARATE copy (not
  hardlinked). The edited `dashboard/index.ts` + the new `use-dinner-suggestion.ts` had to be
  re-synced there before the web build resolved `useDinnerSuggestion` (see 26-VALIDATION.md §5).
