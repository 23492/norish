-- READ ONLY. No writes, no locks beyond a plain read.
--
-- The PRE section is captured immediately before the deploy that carries `0042`
-- (director step, `pg_dump` already taken and verified restorable); the POST
-- section immediately after. (2), (3) and (4) MUST MATCH between PRE and POST --
-- that is what proves no shopping-list link, `recipe_ingredients` row or `steps`
-- row was lost. (1) and (7) are expected to CHANGE (that is the backfill's own
-- effect) and are recorded, not diffed against a fixed expectation.
--
-- COOK-01 / Phase 27 W5. See `0042_backfill_cook_source.sql` for what the
-- migration itself does (the precondition only -- the mutation runs as
-- `backfillCookSource()` at boot, D-27-W5-02).

-- ============================================================================
-- [PRE] -- run BEFORE the deploy.
-- ============================================================================

-- (1) how many recipes exist, and how many already carry a `.cook`.
SELECT
  count(*) AS total_recipes,
  count(*) FILTER (WHERE "cook_source" IS NOT NULL) AS already_has_cook_source
FROM "recipes";

-- (2) every `groceries` row with a shopping-list link, and the exact ids it
--     points at -- the set this migration must never shrink.
SELECT count(*) AS groceries_with_recipe_ingredient_link
FROM "groceries"
WHERE "recipe_ingredient_id" IS NOT NULL;

-- [0042-postcheck:pre-ids] -- G1 fix: this MUST select `recipe_ingredient_id`,
-- not `id`. `groceries.id` is a different uuid space from
-- `recipe_ingredients.id`; selecting it under this alias made the POST
-- anti-join compare the wrong column and return every row as "missing"
-- regardless of whether anything actually broke.
SELECT "recipe_ingredient_id" AS recipe_ingredient_id_at_risk
FROM "groceries"
WHERE "recipe_ingredient_id" IS NOT NULL
ORDER BY "id";

-- (3) `recipe_ingredients` row count per (recipe_id, system_used) -- must be
--     unchanged POST for any recipe that keeps its rows.
SELECT "recipe_id", "system_used", count(*) AS row_count
FROM "recipe_ingredients"
GROUP BY "recipe_id", "system_used"
ORDER BY "recipe_id", "system_used";

-- (4) `steps` row count per (recipe_id, system_used) -- likewise.
SELECT "recipe_id", "system_used", count(*) AS row_count
FROM "steps"
GROUP BY "recipe_id", "system_used"
ORDER BY "recipe_id", "system_used";

-- (5) R1's exposure: grocery rows pointing at a row belonging to a system OTHER
--     than its own recipe's native `system_used`. These are the opposite-system,
--     pre-W3-AI-converted rows the grocery-link guard exists to protect.
SELECT g."id" AS grocery_id, ri."id" AS recipe_ingredient_id, ri."system_used", r."system_used" AS recipe_native_system
FROM "groceries" g
JOIN "recipe_ingredients" ri ON ri."id" = g."recipe_ingredient_id"
JOIN "recipes" r ON r."id" = ri."recipe_id"
WHERE ri."system_used" <> r."system_used";

-- ============================================================================
-- [POST] -- run AFTER the deploy, once the boot log has printed exactly one
-- "Cooklang backfill complete" line.
-- ============================================================================

-- (1) same as PRE (1) -- expected to change: every backfilled recipe now has a
--     non-NULL `cook_source`.
SELECT
  count(*) AS total_recipes,
  count(*) FILTER (WHERE "cook_source" IS NOT NULL) AS already_has_cook_source
FROM "recipes";

-- (2) MUST MATCH PRE (2) exactly -- same count, same id set.
SELECT count(*) AS groceries_with_recipe_ingredient_link
FROM "groceries"
WHERE "recipe_ingredient_id" IS NOT NULL;

-- [0042-postcheck:post-ids] -- same G1 fix as PRE (2): `recipe_ingredient_id`,
-- not `id`.
SELECT "recipe_ingredient_id" AS recipe_ingredient_id_at_risk
FROM "groceries"
WHERE "recipe_ingredient_id" IS NOT NULL
ORDER BY "id";

-- [0042-postcheck:post-antijoin] -- the anti-join: every id from PRE (2) must
-- still exist as a `recipe_ingredients.id` row. A non-empty result here is the
-- failure mode the grocery-link guard exists to prevent -- it means a link
-- that existed PRE is gone POST. Proven to actually catch a loss (not just
-- read correctly) by
-- `packages/db/__tests__/server/db/migrations/0042-backfill-cook-source.test.ts`,
-- which constructs exactly this orphan case against real Postgres.
--
-- Paste the PRE id list into the VALUES list below before running POST.
-- SELECT v.id
-- FROM (VALUES ('<paste PRE ids here>')) AS v(id)
-- LEFT JOIN "recipe_ingredients" ri ON ri."id" = v.id::uuid
-- WHERE ri."id" IS NULL;

-- (3) MUST MATCH PRE (3) exactly, per (recipe_id, system_used).
SELECT "recipe_id", "system_used", count(*) AS row_count
FROM "recipe_ingredients"
GROUP BY "recipe_id", "system_used"
ORDER BY "recipe_id", "system_used";

-- (4) MUST MATCH PRE (4) exactly, per (recipe_id, system_used).
SELECT "recipe_id", "system_used", count(*) AS row_count
FROM "steps"
GROUP BY "recipe_id", "system_used"
ORDER BY "recipe_id", "system_used";

-- (5) same as PRE (5) -- recorded for completeness; not expected to grow.
SELECT g."id" AS grocery_id, ri."id" AS recipe_ingredient_id, ri."system_used", r."system_used" AS recipe_native_system
FROM "groceries" g
JOIN "recipe_ingredients" ri ON ri."id" = g."recipe_ingredient_id"
JOIN "recipes" r ON r."id" = ri."recipe_id"
WHERE ri."system_used" <> r."system_used";

-- (6) the migration count itself: 42 -> 43.
SELECT count(*) FROM drizzle.__drizzle_migrations;

-- (7) per-recipe backfill outcome: which recipes earned a `.cook`, at what
--     confidence, and which are flagged for review.
SELECT "id", "cook_source" IS NOT NULL AS has_cook_source, "cook_confidence", "cook_review_needed"
FROM "recipes"
ORDER BY "id";
