# Phase 16 — Rating Undo — SUMMARY

**Goal:** let a user remove/undo their own recipe rating (recover from an accidental star tap).

## What shipped
- **Backend** (`5bac3a6b`): `removeUserRating(userId, recipeId)` repo fn (delete scoped to `(userId, recipeId)` — can never touch another user's row; idempotent `{removed}`), `ratings.removeRating` tRPC mutation (mirrors `rate`: emits `ratingUpdated` so the average/count refresh in realtime; no `assertRecipeAccess` needed since it only deletes the caller's own row), `RatingRemoveInputSchema` contract.
- **Hook** (`e1f2b283`): `useRatingsMutation().removeRating(recipeId)` — optimistic clear (userRating → null) + rollback on error + invalidates getUserRating/getAverage/getRaters on settle. `isRating` now also reflects the remove mutation.
- **UI** (`a41d978f`, `b5ba2f53` style): `StarRating` gained `userValue` + `onClear` + `clearLabel`. Two ways to undo: (1) click the star you already gave → clears; (2) a × button shown next to the stars when you have a rating. Wired into both recipe-page-mobile + recipe-page-desktop. i18n `recipes.detail.clearRating` added in all 11 locales.
- **Tests** (`bf597607`, `b5ba2f53`): trpc router test (removeRating returns success, always scoped to `ctx.user.id`); **real-Postgres repo test** with cross-user isolation; web hook tests (optimistic clear + mutate wiring).

## Verification
- typecheck: db/shared/trpc/shared-react + **full web `tsc` EXIT 0**.
- `i18n:check`: all 11 locales complete.
- tests: trpc ratings 14/14, **db ratings repo 3/3 (real Postgres)**, web ratings hooks 13/13.
- **Adversarial (security):** weakened `removeUserRating` to delete by `recipeId` only → the cross-user-isolation test went RED ("expected null to be 2" — other user's rating deleted) → reverted (not committed). Proves the test guards the isolation.
- lint: 0 errors (jsx-sort-props warnings fixed; remaining db/shared warnings are pre-existing, not in touched code).

## Lead follow-up
- Build + verify on `norishp2` (Chrome click-through if available). Not merged/deployed yet.
