-- COOK-01 / Phase 27 W5: the live-data backfill for every recipe that predates
-- the full-native Cooklang migration.
--
-- WHAT THIS DOES
--   Every recipe with `cook_source IS NULL` gets a derived `.cook`, a confidence
--   score and a review flag, its projection (`recipe_ingredients` / `steps`)
--   re-materialized UPSERT-stably on the natural key `0041` created. THE
--   MUTATION ITSELF IS NOT IN THIS FILE — it is performed by
--   `backfillCookSource()` in `packages/api/src/startup/backfill-cook-source.ts`,
--   called at boot immediately after `runMigrations()` (D-27-W5-02). Minting a
--   `.cook` needs the pure serializer, `escapeCookText`, the nine size caps,
--   `findCookSourceDefect` and the pooled bounded WASM parser -- none of that is
--   expressible in SQL, and a SQL re-implementation would bypass exactly the
--   injection surface T-27-01 closed. This migration therefore carries only the
--   journal entry and asserts its own precondition.
--
-- PRECONDITION
--   `uq_recipe_ingredients_recipe_system_ingredient` (created by `0041`) is the
--   natural key `deriveProjectionTx`'s UPSERT depends on. Without it the backfill's
--   write would silently delete-and-reinsert instead of preserving
--   `recipe_ingredients.id` -- exactly the FK class of defect `0041` closed. Fail
--   loudly here rather than let that happen quietly.
--
-- FORWARD-ONLY (D-27-W5-05 in the threat register; stated plainly here too)
--   Rolling the image back does NOT undo this. The previous image reads
--   `cook_source` fine (nullable; the renderer forks on it), but rows the
--   backfill rewrote stay rewritten. The ONLY recovery path is restoring the
--   pre-run `pg_dump`, taken and verified immediately before the deploy.
--
-- READ-ONLY CHECK
--   `checks/0042-postcheck.sql` carries the PRE/POST queries the live run is
--   verified against: outcome counts, grocery-link survival, per-recipe row
--   counts, and the migration count itself.

-- [0042:precondition] `0041`'s natural-key index must already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'uq_recipe_ingredients_recipe_system_ingredient'
      AND relkind = 'i'
  ) THEN
    RAISE EXCEPTION
      'migration 0042 precondition failed: uq_recipe_ingredients_recipe_system_ingredient does not exist (0041 must run first)';
  END IF;
END $$;
