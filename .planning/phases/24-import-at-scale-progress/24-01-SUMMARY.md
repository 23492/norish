# 24-01 SUMMARY — Bulk import fan-out + cookbook-scoped import progress (backend)

**Commit:** `21cccba8`
**Requirements:** BULK-01, IMPORT-UX-01

## What shipped
- **`parseBulkImportUrls(text)` + `MAX_BULK_IMPORT_URLS = 25`** in
  `packages/shared/src/lib/helpers.ts` (D-24-01/02) — extracts http(s) URLs from free text,
  strips trailing prose punctuation, validates with `httpUrlSchema`, dedups with
  `normalizeUrl`, caps at 25 (excess = `truncated`). No crawl.
- **`RECIPE_IMPORT_STAGES = ["fetching","saving"]` + `RecipeImportStage`** in
  `packages/shared/src/contracts/dto/queue.ts` (D-24-03), value exported from the contracts
  index.
- **`importProgress` realtime event** on `RecipeSubscriptionEvents`
  (`packages/shared-server/src/realtime/recipes.ts`) + **`emitImportProgress`**
  (`packages/queue/src/recipe-import/progress.ts`) — a thin wrapper over `emitByPolicy`;
  the worker (`worker.ts`) reuses the scope it already resolved for the job and emits
  `fetching` before parse and `saving` before the DB write. NEVER broadcasts (D-24-04).
- **`recipes.importFromUrls` tRPC procedure** (`recipes.ts` + `recipes-openapi-types.ts`) —
  fans URLs out over the SAME `addImportJob` path as the single import (one job per URL,
  each carrying the active cookbook), returning per-item `queued`/`exists`/`duplicate`
  (+ `existingRecipeId`). Cap enforced in the zod schema so direct API callers are bounded.
- **`onImportProgress` subscription** added to the recipes subscriptions router.

## Tests
- `bulk-fan-out-isolation.test.ts` (3) — REAL `addImportJob`/`generateJobId` against a
  stateful in-memory queue under LIVE `view:"everyone"`: two cookbooks importing the same
  URL get distinct job ids; dedup stays within the actor's cookbook; a repeat within one
  batch is a `duplicate`.
- `progress-isolation.test.ts` (3) — REAL `emitImportProgress` + `emitByPolicy`, every case
  incl. the `everyone` sibling: clamps to the household channel, never broadcasts, personal
  import routes to the user channel.
- `fan-out-isolation.test.ts` — `importProgress` added to the shared RECIPE_EVENTS matrix.

## Decisions
- Cap = 25 (D-24-01); extract-not-crawl (D-24-02); honest witnessed stages only (D-24-03);
  progress cookbook-scoped never broadcast (D-24-04); no migration (D-24-05).
