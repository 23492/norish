-- READ ONLY. Run against a RESTORE of the live dump, never against live.
--
-- Sizes the ONLY user-visible risk in migration `0041` (COOK-01 / Phase 27 W2,
-- <risks> R1): the unique index on `(recipe_id, system_used, ingredient_id)`
-- makes two deliberately-separate lines of the same ingredient ("2 eggs" +
-- "1 egg for the wash") impossible, so `0041` merges them and the recipe visibly
-- loses a line.
--
-- Three SELECTs, no writes, no locks beyond a plain read:
--   (a) how many groups collapse at all;
--   (b) how many of those collapse LOSSILY (mixed or NULL units, or a NULL
--       amount) -- these keep the survivor's amount verbatim and set
--       `recipes.cook_review_needed = true`;
--   (c) how many `groceries` rows currently point at a row `0041` will delete --
--       every one of these is RE-POINTED onto the survivor before the delete, so
--       the expected post-migration loss is ZERO. A non-zero count here is not a
--       defect, it is the number of links the re-point step has to save.
--
-- If (b) is non-trivial, STOP and surface it to Kiran before `0041` is deployed.
-- Do NOT tune the merge rule to make the number smaller.

-- (a) duplicate groups.
SELECT count(*) AS duplicate_groups
FROM (
  SELECT "recipe_id", "system_used", "ingredient_id"
  FROM "recipe_ingredients"
  GROUP BY "recipe_id", "system_used", "ingredient_id"
  HAVING count(*) > 1
) AS dupes;

-- (b) of those, how many merge LOSSILY.
SELECT count(*) AS lossy_groups
FROM (
  SELECT "recipe_id", "system_used", "ingredient_id"
  FROM "recipe_ingredients"
  GROUP BY "recipe_id", "system_used", "ingredient_id"
  HAVING count(*) > 1
     AND NOT (
       count(*) FILTER (WHERE "amount" IS NULL) = 0
       AND (
         count(*) FILTER (WHERE "unit" IS NULL) = count(*)
         OR (count(*) FILTER (WHERE "unit" IS NULL) = 0 AND count(DISTINCT "unit") = 1)
       )
     )
) AS lossy;

-- (c) grocery rows pointing at a row that is about to be deleted (i.e. at a
--     non-survivor of a duplicate group). `0041` re-points all of them first.
SELECT count(*) AS groceries_repointed
FROM "groceries" AS g
JOIN "recipe_ingredients" AS ri ON ri."id" = g."recipe_ingredient_id"
WHERE ri."id" <> (
  SELECT s."id"
  FROM "recipe_ingredients" AS s
  WHERE s."recipe_id" = ri."recipe_id"
    AND s."system_used" = ri."system_used"
    AND s."ingredient_id" = ri."ingredient_id"
  ORDER BY s."order" ASC NULLS LAST, s."id" ASC
  LIMIT 1
);
