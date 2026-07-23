# 24-02 SUMMARY — Bulk import modal + real progress indicator (frontend)

**Commit:** `5854844d`
**Requirements:** BULK-01, IMPORT-UX-01

## Resume note
The shared-react data layer (import-stage cache, bulk mutation, progress subscription) was
in-flight and UNCOMMITTED when the prior session was interrupted. On resume it was reviewed
against the 24-01 backend contract, found coherent and compiling, and **finished forward**
(not discarded, not blindly committed): the `onImportProgress` `onData` shape, the
`importFromUrls` mutation input, and the `RecipeImportStage`/`BulkImportResult` types all
match `21cccba8`. The remaining UI consumers + i18n + test-mock updates were added on top.

## What shipped
- **Client-only import-stage cache** (`use-recipes-cache.ts`,
  `use-pending-recipes-query.ts`) — `IMPORT_STAGES_QUERY_KEY`, a queryFn-less cache
  (staleTime/gcTime Infinity) written by `setImportStage`/`clearImportStage`; exposed as an
  `importStages` Map, threaded through `useRecipesQuery`.
- **Progress subscription** — `onImportProgress` → `setImportStage(recipeId, stage)`
  (`use-recipes-subscription.ts`); `removePendingRecipe` clears the stage when the import
  lands. Cookbook-scoped server-side, so a client only ever receives its own cookbook's.
- **Bulk mutation** — `importRecipesFromUrls(urls, forceAI?)` (`use-recipes-mutations.ts`)
  registers a pending skeleton per `queued` item; `importStages` + `importRecipesFromUrls`
  + the bulk-result types added to the shared context surface.
- **Progress indicator** — `RecipeCardSkeleton` gains an optional `stage` rendering an
  indeterminate spinner + stage label; `recipe-grid.tsx` passes `importStages.get(id)` per
  pending skeleton (single AND bulk).
- **Bulk import modal** (`import-recipe-modal.tsx`) — multiline TextArea, `parseBulkImportUrls`
  detected-count + over-cap preview; 1 URL → the existing single path (unchanged optimistic
  UX), >1 → `importRecipesFromUrls` with a per-item summary toast (queued / already-importing
  / already-in-cookbook / skipped).
- **i18n** — `common.import.url.{bulkLabel,bulkPlaceholder,detected,overCap,bulk.*}` +
  `common.import.progress.{fetching,saving}` in ALL 12 locales.

## Tests
- Extended the trpc mocks in three web tests for `importFromUrls` + `onImportProgress`, added
  a `TextArea` to the modal test's heroui mock, and filled the pre-existing `move` mock gap
  (Phase 23 left `use-recipes-mutations.test.ts` red at baseline). web 424/424 green.

## Gates
typecheck 17/17 EXIT 0 · lint 0 errors · web build EXIT 0 · queue 88 · trpc 294 · web 424 ·
shared-react 37 · shared-server realtime isolation 27 · `i18n:check` exit 1 SOLELY on the
pre-existing `no`-locale 68-key gap (zero new gaps — proven by stash-diff).
