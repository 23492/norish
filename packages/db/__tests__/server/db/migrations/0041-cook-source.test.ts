// @vitest-environment node
/**
 * Migration `0041_add_cook_source` (COOK-01 / Phase 27 W2).
 *
 * `RepositoryTestBase` spins up a real testcontainers Postgres and applies EVERY
 * `packages/db/src/migrations/*.sql` in filename order, so `0041` itself is what
 * these assertions run against — there is no hand-built schema to drift from.
 *
 * Three things are proven:
 *  1. the EXPAND half landed (three columns, right nullability/default, and the
 *     unique index on the projection's natural key);
 *  2. the unique index actually BITES (a second row on the same
 *     `(recipe_id, system_used, ingredient_id)` is rejected);
 *  3. the de-dup is FK-SAFE (D-27-W2-07): a `groceries` row pointing at a LOSER
 *     ends up pointing at the SURVIVOR, never at NULL. An empty database proves
 *     nothing here, so the duplicate case is built by hand (drop the index, insert
 *     the duplicate, point a grocery at the loser) and the de-dup + index
 *     statements are READ OUT OF THE MIGRATION FILE and replayed, so the test can
 *     never drift from the SQL that will run on live.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createHousehold } from "@norish/db";
import { groceries, ingredients, recipeIngredients, recipes } from "@norish/db/schema";

import { createTestIngredient, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const MIGRATION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../src/migrations/0041_add_cook_source.sql"
);

const UNIQUE_INDEX = "uq_recipe_ingredients_recipe_system_ingredient";

/**
 * Pull the tagged statements straight out of `0041`. The migration marks them with
 * `-- [0041:dedup]` and `-- [0041:unique-index]`; splitting on drizzle's
 * `--> statement-breakpoint` is safe because the `DO $$ ... $$` body never
 * contains that marker.
 */
async function migrationStatements(): Promise<{ dedup: string; uniqueIndex: string }> {
  const source = await readFile(MIGRATION_PATH, "utf8");
  const statements = source.split("--> statement-breakpoint");
  const dedup = statements.find((s) => s.includes("[0041:dedup]"));
  const uniqueIndex = statements.find((s) => s.includes("[0041:unique-index]"));

  if (!dedup || !uniqueIndex) {
    throw new Error("0041 lost its [0041:dedup] / [0041:unique-index] markers");
  }

  return { dedup, uniqueIndex };
}

describe("migration 0041_add_cook_source", () => {
  const testBase = new RepositoryTestBase("migration_0041");

  let userId: string;
  let householdId: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userId = user.id;
    const household = await createHousehold({ name: "Cookbook 0041", adminUserId: userId });

    householdId = household.id;
  });

  describe("EXPAND half", () => {
    it("adds cook_source / cook_confidence / cook_review_needed with the right shape", async () => {
      const db = getTestDb();
      const rows = await db.execute<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(sql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'recipes'
          AND column_name IN ('cook_source', 'cook_confidence', 'cook_review_needed')
        ORDER BY column_name
      `);
      const byName = new Map(rows.rows.map((r) => [r.column_name, r]));

      expect(byName.get("cook_source")).toMatchObject({
        data_type: "text",
        is_nullable: "YES",
      });
      expect(byName.get("cook_confidence")).toMatchObject({
        data_type: "numeric",
        is_nullable: "YES",
      });
      expect(byName.get("cook_review_needed")).toMatchObject({
        data_type: "boolean",
        is_nullable: "NO",
      });
      expect(byName.get("cook_review_needed")?.column_default).toContain("false");
    });

    it("defaults cook_review_needed to false and leaves cook_source NULL on a new recipe", async () => {
      const db = getTestDb();
      const [row] = await db
        .insert(recipes)
        .values({ userId, householdId, name: "Fresh recipe" })
        .returning({
          cookSource: recipes.cookSource,
          cookConfidence: recipes.cookConfidence,
          cookReviewNeeded: recipes.cookReviewNeeded,
        });

      expect(row?.cookSource).toBeNull();
      expect(row?.cookConfidence).toBeNull();
      expect(row?.cookReviewNeeded).toBe(false);
    });

    it("creates the unique index on (recipe_id, system_used, ingredient_id)", async () => {
      const db = getTestDb();
      const rows = await db.execute<{ indexdef: string }>(sql`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'recipe_ingredients' AND indexname = ${UNIQUE_INDEX}
      `);

      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.indexdef).toContain("UNIQUE INDEX");
      expect(rows.rows[0]?.indexdef).toMatch(/recipe_id/);
      expect(rows.rows[0]?.indexdef).toMatch(/system_used/);
      expect(rows.rows[0]?.indexdef).toMatch(/ingredient_id/);
    });
  });

  describe("the constraint bites", () => {
    it("rejects a second row on the same (recipe_id, system_used, ingredient_id)", async () => {
      const db = getTestDb();
      const [recipe] = await db
        .insert(recipes)
        .values({ userId, householdId, name: "Dupe recipe" })
        .returning({ id: recipes.id });
      const ingredient = await createTestIngredient({ name: `egg-${Date.now()}` });

      await db.insert(recipeIngredients).values({
        recipeId: recipe!.id,
        ingredientId: ingredient!.id,
        amount: "2",
        unit: "piece",
        order: "0",
        systemUsed: "metric",
      });

      // drizzle re-wraps the pg error, so the unique-violation detail rides on
      // `cause`. Assert on THAT index by name — "it threw something" would also
      // pass if the row were rejected for an unrelated reason.
      const error = await db
        .insert(recipeIngredients)
        .values({
          recipeId: recipe!.id,
          ingredientId: ingredient!.id,
          amount: "1",
          unit: "piece",
          order: "1",
          systemUsed: "metric",
        })
        .then(
          () => null,
          (err: unknown) => err
        );

      expect(error).not.toBeNull();

      const cause = (error as { cause?: { message?: string; code?: string } }).cause;

      expect(cause?.code).toBe("23505");
      expect(cause?.message).toContain(UNIQUE_INDEX);
    });

    it("still allows the SAME ingredient in the OTHER measurement system", async () => {
      const db = getTestDb();
      const [recipe] = await db
        .insert(recipes)
        .values({ userId, householdId, name: "Both systems" })
        .returning({ id: recipes.id });
      const ingredient = await createTestIngredient({ name: `flour-${Date.now()}` });

      await db.insert(recipeIngredients).values([
        {
          recipeId: recipe!.id,
          ingredientId: ingredient!.id,
          amount: "200",
          unit: "gram",
          order: "0",
          systemUsed: "metric",
        },
        {
          recipeId: recipe!.id,
          ingredientId: ingredient!.id,
          amount: "7.05",
          unit: "ounce",
          order: "0",
          systemUsed: "us",
        },
      ]);

      const rows = await db
        .select()
        .from(recipeIngredients)
        .where(sql`${recipeIngredients.recipeId} = ${recipe!.id}`);

      expect(rows).toHaveLength(2);
    });
  });

  describe("the FK-safe de-dup (D-27-W2-07, T-27-03)", () => {
    /**
     * Build a duplicate group by hand: the index has to come off first, because
     * `0041` already created it on this database.
     */
    async function seedDuplicateGroup(options: {
      loserUnit: string | null;
      survivorUnit: string | null;
      loserAmount: string | null;
      survivorAmount: string | null;
    }) {
      const db = getTestDb();

      await db.execute(sql.raw(`DROP INDEX "${UNIQUE_INDEX}"`));

      const [recipe] = await db
        .insert(recipes)
        .values({ userId, householdId, name: "Duplicate lines" })
        .returning({ id: recipes.id });
      const ingredient = await createTestIngredient({ name: `dupe-${Date.now()}-${Math.random()}` });

      const [survivor] = await db
        .insert(recipeIngredients)
        .values({
          recipeId: recipe!.id,
          ingredientId: ingredient!.id,
          amount: options.survivorAmount,
          unit: options.survivorUnit,
          order: "0",
          systemUsed: "metric",
        })
        .returning({ id: recipeIngredients.id });
      const [loser] = await db
        .insert(recipeIngredients)
        .values({
          recipeId: recipe!.id,
          ingredientId: ingredient!.id,
          amount: options.loserAmount,
          unit: options.loserUnit,
          order: "5",
          systemUsed: "metric",
        })
        .returning({ id: recipeIngredients.id });

      // A household shopping-list entry pointing at the row that is about to die.
      // `groceries.recipe_ingredient_id` is ON DELETE SET NULL, so a naive de-dup
      // would silently null this out — the Phase 25 class of defect.
      const [grocery] = await db
        .insert(groceries)
        .values({
          userId,
          householdId,
          name: "dupe ingredient",
          recipeIngredientId: loser!.id,
        })
        .returning({ id: groceries.id });

      return {
        recipeId: recipe!.id,
        ingredientId: ingredient!.id,
        survivorId: survivor!.id,
        loserId: loser!.id,
        groceryId: grocery!.id,
      };
    }

    async function replayDedupAndIndex() {
      const db = getTestDb();
      const { dedup, uniqueIndex } = await migrationStatements();

      await db.execute(sql.raw(dedup));
      await db.execute(sql.raw(uniqueIndex));
    }

    it("re-points the grocery FK onto the SURVIVOR before deleting the loser", async () => {
      const db = getTestDb();
      const seeded = await seedDuplicateGroup({
        survivorUnit: "gram",
        loserUnit: "gram",
        survivorAmount: "200",
        loserAmount: "50",
      });

      await replayDedupAndIndex();

      const surviving = await db
        .select({ id: recipeIngredients.id, amount: recipeIngredients.amount })
        .from(recipeIngredients)
        .where(sql`${recipeIngredients.recipeId} = ${seeded.recipeId}`);

      expect(surviving).toHaveLength(1);
      expect(surviving[0]?.id).toBe(seeded.survivorId);

      const [grocery] = await db
        .select({ recipeIngredientId: groceries.recipeIngredientId })
        .from(groceries)
        .where(sql`${groceries.id} = ${seeded.groceryId}`);

      // THE assertion. Not null, and specifically the survivor.
      expect(grocery?.recipeIngredientId).not.toBeNull();
      expect(grocery?.recipeIngredientId).toBe(seeded.survivorId);
    });

    it("sums the amounts into the survivor when the merge is LOSSLESS (same unit)", async () => {
      const db = getTestDb();
      const seeded = await seedDuplicateGroup({
        survivorUnit: "gram",
        loserUnit: "gram",
        survivorAmount: "200",
        loserAmount: "50",
      });

      await replayDedupAndIndex();

      const [row] = await db
        .select({ amount: recipeIngredients.amount, unit: recipeIngredients.unit })
        .from(recipeIngredients)
        .where(sql`${recipeIngredients.id} = ${seeded.survivorId}`);

      expect(Number(row?.amount)).toBe(250);
      expect(row?.unit).toBe("gram");

      const [recipe] = await db
        .select({ reviewNeeded: recipes.cookReviewNeeded })
        .from(recipes)
        .where(sql`${recipes.id} = ${seeded.recipeId}`);

      expect(recipe?.reviewNeeded).toBe(false);
    });

    it("keeps the survivor verbatim and flags cook_review_needed on a LOSSY merge (mixed units)", async () => {
      const db = getTestDb();
      const seeded = await seedDuplicateGroup({
        survivorUnit: "gram",
        loserUnit: "tablespoon",
        survivorAmount: "200",
        loserAmount: "2",
      });

      await replayDedupAndIndex();

      const [row] = await db
        .select({ amount: recipeIngredients.amount, unit: recipeIngredients.unit })
        .from(recipeIngredients)
        .where(sql`${recipeIngredients.id} = ${seeded.survivorId}`);

      expect(Number(row?.amount)).toBe(200);
      expect(row?.unit).toBe("gram");

      const [recipe] = await db
        .select({ reviewNeeded: recipes.cookReviewNeeded })
        .from(recipes)
        .where(sql`${recipes.id} = ${seeded.recipeId}`);

      expect(recipe?.reviewNeeded).toBe(true);

      // The grocery link is re-pointed either way — a lossy merge must not cost a link.
      const [grocery] = await db
        .select({ recipeIngredientId: groceries.recipeIngredientId })
        .from(groceries)
        .where(sql`${groceries.id} = ${seeded.groceryId}`);

      expect(grocery?.recipeIngredientId).toBe(seeded.survivorId);
    });

    it("flags a LOSSY merge when an amount is NULL and never fabricates a sum", async () => {
      const db = getTestDb();
      const seeded = await seedDuplicateGroup({
        survivorUnit: null,
        loserUnit: null,
        survivorAmount: "1",
        loserAmount: null,
      });

      await replayDedupAndIndex();

      const [row] = await db
        .select({ amount: recipeIngredients.amount })
        .from(recipeIngredients)
        .where(sql`${recipeIngredients.id} = ${seeded.survivorId}`);

      expect(Number(row?.amount)).toBe(1);

      const [recipe] = await db
        .select({ reviewNeeded: recipes.cookReviewNeeded })
        .from(recipes)
        .where(sql`${recipes.id} = ${seeded.recipeId}`);

      expect(recipe?.reviewNeeded).toBe(true);
    });

    it("is a no-op on a database with zero duplicates (the live case) and stays re-runnable", async () => {
      const db = getTestDb();
      const [recipe] = await db
        .insert(recipes)
        .values({ userId, householdId, name: "Clean recipe" })
        .returning({ id: recipes.id });
      const ingredient = await createTestIngredient({ name: `clean-${Date.now()}` });
      const [row] = await db
        .insert(recipeIngredients)
        .values({
          recipeId: recipe!.id,
          ingredientId: ingredient!.id,
          amount: "200",
          unit: "gram",
          order: "0",
          systemUsed: "metric",
        })
        .returning({ id: recipeIngredients.id, version: recipeIngredients.version });

      await replayDedupAndIndex();

      const after = await db
        .select({ id: recipeIngredients.id, version: recipeIngredients.version })
        .from(recipeIngredients)
        .where(sql`${recipeIngredients.recipeId} = ${recipe!.id}`);

      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(row!.id);
      expect(after[0]?.version).toBe(row!.version);

      const [unchanged] = await db
        .select({ reviewNeeded: recipes.cookReviewNeeded })
        .from(recipes)
        .where(sql`${recipes.id} = ${recipe!.id}`);

      expect(unchanged?.reviewNeeded).toBe(false);
    });
  });

  it("leaves the ingredient dictionary alone (sanity: the migration touches no other table)", async () => {
    const db = getTestDb();
    const before = await db.select({ id: ingredients.id }).from(ingredients);

    const { dedup } = await migrationStatements();

    await db.execute(sql.raw(dedup));

    const after = await db.select({ id: ingredients.id }).from(ingredients);

    expect(after.map((r) => r.id).sort()).toEqual(before.map((r) => r.id).sort());
  });
});
