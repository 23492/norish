---
phase: 04-sharing
plan: SHARE-02
subsystem: sharing
requires: [SHARE-01]
provides: [save-to-account]
requirements-completed: [SHARE-02]
human-verify: PENDING (lead — Chrome)
completed: 2026-06-14
note: "Close-out written by the lead — the executor committed all code + tests (c1f61709, 5deb121b, 07d3647b) but died on an Anthropic API overload before writing this SUMMARY. Code verified sound by the lead (see Self-Check)."
---

# Phase 04 SHARE-02: Save-to-account from a shared recipe — Summary

A logged-in user can **Save** a publicly-shared recipe (reached via a `/share/<token>` link) into their **active cookbook** as a new recipe they own. Logged-out users go through the existing login/signup flow (which still respects `registration_enabled`) and return to complete the save. Builds directly on SHARE-01's public share-token surface.

## Key files
- `packages/trpc/src/routers/recipes/shares.ts` — `saveShared` mutation (authed; token-gated).
- `packages/trpc/src/middleware.ts` — token→recipe resolution reused/extended for the save authorization.
- `packages/db/src/repositories/recipes.ts` (+97) — deep-copy logic (name/desc/image/ingredients/steps/times/categories/tags) into the saver's active cookbook via the existing `createRecipeWithRefs(recipeId, userId, householdId, input)`.
- `packages/shared-server/src/media/storage.ts` (+46) — media copy for the saved recipe.
- `packages/shared/src/contracts/zod/recipe-shares.ts` + `dto/recipe-shares.d.ts` — input/output contracts.
- `apps/web` /share page — "Save to my cookbook" button + login-return flow.
- `packages/i18n/src/messages/<11 locales>/recipes.json` — +9 keys each (nl+en real, 9 EN-fallback).
- Tests: `packages/db/__tests__/server/db/repositories/recipe-shares.test.ts` (+119), `packages/trpc/__tests__/recipes/shares.test.ts` (+127).

## Locked decisions (per the lead's brief)
1. Save target = the saver's **active cookbook** (`household_id = ctx.household?.id ?? null`, `userId = saver`); a NEW owned recipe (deep copy, not a reference).
2. Save requires login; logged-out → existing login/signup (no registration bypass) → return + save.
3. **Authorization:** only a recipe reachable via a valid **active public share token** is savable — you cannot save an arbitrary or private/household recipe id (gated on the SHARE-01 token→recipe path).
4. Plain copy now; VERSION-01 lineage deferred (forward-compatible — a future `parent_recipe_id` can be added).
5. i18n across all 11 locales.

## Self-Check: PASSED (verified by the lead after the executor's overload)
- typecheck: `@norish/{shared, shared-server, db, trpc, web}` all **OK**.
- `pnpm i18n:check`: **exit 0** (all 11 locales complete).
- Tests: `@norish/trpc` shares suite **255/255 passed**; `@norish/db` **recipe-shares.test.ts 10/10 passed** (the saveShared copy + authorization + per-cookbook-scoping rigor).
- The only failing db tests are the **3 pre-existing `ingredient-unit-normalization.test.ts > updateRecipeWithRefs` failures** — documented out-of-scope (a follow-up task is filed), unrelated to SHARE-02.
- Per-cookbook isolation (HOUSE-06) intact: `households.isolation` green; the save copies into the saver's OWN active cookbook (no cross-cookbook leak; the source must be public-shared).

## Next Phase Readiness
Code-complete + statically verified + test-green. **Lead Chrome-verify pending:** open a public `/share/<token>` → Save → confirm it appears in the saver's active cookbook as their own recipe. Commits `c1f61709`, `5deb121b`, `07d3647b` on `feat/phase-2-multi-household`.
