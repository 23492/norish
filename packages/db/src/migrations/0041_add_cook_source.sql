-- COOK-01 / Phase 27 W2: EXPAND for the full-native Cooklang migration.
--
-- WHAT THIS DOES
--   1. `recipes` gains three ADDITIVE, nullable/defaulted columns:
--      `cook_source` (the `.cook` source of truth), `cook_confidence` (W5's
--      backfill gate score) and `cook_review_needed` (W5's review queue flag).
--      Nothing populates them in this wave; every existing recipe keeps
--      `cook_source IS NULL` and renders exactly as before.
--   2. `recipe_ingredients` gains the UNIQUE index
--      `uq_recipe_ingredients_recipe_system_ingredient` on
--      `(recipe_id, system_used, ingredient_id)`. That tuple is the NATURAL KEY
--      of the derived projection: `deriveProjectionTx` UPSERTs on it instead of
--      delete-and-reinsert, so `recipe_ingredients.id` survives a recipe edit
--      and `groceries.recipe_ingredient_id` links survive with it (§2.5).
--
-- FK SAFETY (D-27-W2-07 — the Phase 25 lesson)
--   The unique index cannot be created while duplicate rows exist, and
--   `groceries.recipe_ingredient_id` is `ON DELETE SET NULL`: deleting a
--   duplicate naively would silently null out a household's "from recipe X"
--   shopping-list link. The de-dup below therefore, per group, in this order:
--     (a) picks the survivor = lowest `order` (NULLS LAST), tie-broken by lowest `id`;
--     (b) RE-POINTS every `groceries.recipe_ingredient_id` off the losers onto the
--         survivor -- BEFORE ANY DELETE. This ordering is the whole point of the
--         block; reversing it is a data-loss defect, not a style choice;
--     (c) sums `amount` into the survivor ONLY when the merge is lossless (no NULL
--         amount, and every row shares one unit or every row's unit is NULL);
--         otherwise the survivor keeps its own amount/unit verbatim and the recipe
--         is flagged `cook_review_needed = true` for W5's review queue;
--     (d) deletes the losers;
--   and only then is the unique index created.
--
--   Merging two deliberately-separate lines ("2 eggs" + "1 egg for the wash") is
--   genuinely user-visible. `checks/0041-precheck.sql` is the READ-ONLY dry-run the
--   director runs against a RESTORE of the live dump to size that before deploy.
--   Verified against the live data set (164 rows / 7 recipes): ZERO duplicate
--   groups, ZERO grocery links at risk -- the block is a no-op there, and is
--   written defensively so it is correct in any environment.
--
-- ROLLBACK
--   Additive half: fully reversible --
--     DROP INDEX "uq_recipe_ingredients_recipe_system_ingredient";
--     ALTER TABLE "recipes" DROP COLUMN "cook_review_needed", DROP COLUMN
--       "cook_confidence", DROP COLUMN "cook_source";
--   De-dup half: NOT reversible. If it merged rows, the only rollback is
--   restore-from-dump. Confirm a verified-restorable backup before deploying.

ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "cook_source" text;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "cook_confidence" numeric(4, 3);--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "cook_review_needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- [0041:dedup] FK-safe de-duplication of `(recipe_id, system_used, ingredient_id)`.
-- Re-point groceries FIRST, delete second. No-op when there are no duplicates.
DO $$
DECLARE
  grp RECORD;
  survivor_id uuid;
  loser_ids uuid[];
  total_rows integer;
  distinct_units integer;
  null_units integer;
  null_amounts integer;
  merged_amount numeric;
BEGIN
  FOR grp IN
    SELECT "recipe_id", "system_used", "ingredient_id"
    FROM "recipe_ingredients"
    GROUP BY "recipe_id", "system_used", "ingredient_id"
    HAVING count(*) > 1
  LOOP
    -- (a) survivor: lowest `order` (NULL orders sort last), tie-broken by lowest id.
    SELECT "id" INTO survivor_id
    FROM "recipe_ingredients"
    WHERE "recipe_id" = grp."recipe_id"
      AND "system_used" = grp."system_used"
      AND "ingredient_id" = grp."ingredient_id"
    ORDER BY "order" ASC NULLS LAST, "id" ASC
    LIMIT 1;

    SELECT array_agg("id") INTO loser_ids
    FROM "recipe_ingredients"
    WHERE "recipe_id" = grp."recipe_id"
      AND "system_used" = grp."system_used"
      AND "ingredient_id" = grp."ingredient_id"
      AND "id" <> survivor_id;

    -- (b) RE-POINT the shopping-list FKs onto the survivor BEFORE any delete.
    UPDATE "groceries"
    SET "recipe_ingredient_id" = survivor_id
    WHERE "recipe_ingredient_id" = ANY(loser_ids);

    -- (c) lossless merge test: no NULL amount, and either every unit is NULL or
    --     every unit is the same non-NULL value.
    SELECT count(*),
           count(DISTINCT "unit"),
           count(*) FILTER (WHERE "unit" IS NULL),
           count(*) FILTER (WHERE "amount" IS NULL),
           sum("amount")
      INTO total_rows, distinct_units, null_units, null_amounts, merged_amount
    FROM "recipe_ingredients"
    WHERE "recipe_id" = grp."recipe_id"
      AND "system_used" = grp."system_used"
      AND "ingredient_id" = grp."ingredient_id";

    IF null_amounts = 0
       AND (null_units = total_rows OR (null_units = 0 AND distinct_units = 1)) THEN
      UPDATE "recipe_ingredients"
      SET "amount" = merged_amount,
          "updated_at" = now(),
          "version" = "version" + 1
      WHERE "id" = survivor_id;
    ELSE
      UPDATE "recipes" SET "cook_review_needed" = true WHERE "id" = grp."recipe_id";
    END IF;

    -- (d) only now may the losers go.
    DELETE FROM "recipe_ingredients" WHERE "id" = ANY(loser_ids);
  END LOOP;
END $$;--> statement-breakpoint

-- [0041:unique-index] The projection's natural key. `system_used` is NOT NULL, so
-- Postgres' NULL-distinctness rule cannot weaken this index.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_recipe_ingredients_recipe_system_ingredient" ON "recipe_ingredients" USING btree ("recipe_id","system_used","ingredient_id");
