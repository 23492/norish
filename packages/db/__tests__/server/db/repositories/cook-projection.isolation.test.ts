// @vitest-environment node
/**
 * COOK-01 / Phase 27 W2 — `deriveProjectionTx` recipe/cookbook isolation
 * (HOUSE-06). SECURITY-CRITICAL.
 *
 * The projection writer DELETES and UPDATES `recipe_ingredients` and `steps`. If
 * any of its statements lost its `recipe_id` predicate, deriving one recipe would
 * silently rewrite or destroy another cookbook's recipe — and because the writer
 * runs inside the caller's transaction on a legitimate write, nothing would ever
 * report an error.
 *
 * The trap this suite is built to catch: two recipes in two DIFFERENT cookbooks
 * with an IDENTICAL ingredient set. Row COUNTS alone would not move if an unscoped
 * statement rewrote the neighbour, so the assertions compare ids, values, `version`
 * and `updated_at` — an unscoped UPDATE bumps those even when it changes nothing else.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CookTokensDTO } from "@norish/shared/contracts";
import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { createHousehold, deriveProjectionTx } from "@norish/db";
import { db } from "@norish/db/drizzle";
import { groceries, recipeIngredients, recipes, steps } from "@norish/db/schema";

import { createTestUser, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const units = defaultUnits as UnitsMap;

function tokens(amount: number): CookTokensDTO {
  return [
    {
      order: 0,
      section: null,
      tokens: [
        { type: "text", value: "Whisk the " },
        { type: "ingredient", name: "flour", amount, unit: "gram" },
        { type: "text", value: " and " },
        { type: "ingredient", name: "milk", amount: 300, unit: "milliliter" },
        { type: "text", value: "." },
      ],
    },
  ];
}

describe("deriveProjectionTx isolation (HOUSE-06)", () => {
  const testBase = new RepositoryTestBase("cook_projection_isolation");

  let userU: string;
  let userV: string;
  let cookbookA: string;
  let cookbookB: string;
  let recipeA: string;
  let recipeB: string;
  let groceryB: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userU = user.id;
    userV = (await createTestUser()).id;

    cookbookA = (await createHousehold({ name: "Cookbook A", adminUserId: userU })).id;
    cookbookB = (await createHousehold({ name: "Cookbook B", adminUserId: userV })).id;

    const testDb = getTestDb();
    const [a] = await testDb
      .insert(recipes)
      .values({ userId: userU, householdId: cookbookA, name: "A pancakes", systemUsed: "metric" })
      .returning({ id: recipes.id });
    const [b] = await testDb
      .insert(recipes)
      .values({ userId: userV, householdId: cookbookB, name: "B pancakes", systemUsed: "metric" })
      .returning({ id: recipes.id });

    recipeA = a!.id;
    recipeB = b!.id;

    // IDENTICAL ingredient sets, so an unscoped statement has something to hit.
    await db.transaction((tx) =>
      deriveProjectionTx(tx, {
        recipeId: recipeA,
        systemUsed: "metric",
        cookTokens: tokens(200),
        units,
      })
    );
    await db.transaction((tx) =>
      deriveProjectionTx(tx, {
        recipeId: recipeB,
        systemUsed: "metric",
        cookTokens: tokens(200),
        units,
      })
    );

    // Cookbook B's shopping list links to B's projection.
    const [bRow] = await testDb
      .select({ id: recipeIngredients.id })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeB))
      .limit(1);
    const [grocery] = await testDb
      .insert(groceries)
      .values({
        userId: userV,
        householdId: cookbookB,
        name: "flour",
        recipeIngredientId: bRow!.id,
      })
      .returning({ id: groceries.id });

    groceryB = grocery!.id;
  });

  async function snapshotOf(recipeId: string) {
    const testDb = getTestDb();
    const ingredientRows = await testDb
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(recipeIngredients.systemUsed, recipeIngredients.order);
    const stepRows = await testDb
      .select()
      .from(steps)
      .where(eq(steps.recipeId, recipeId))
      .orderBy(steps.order);
    const groceryRows = await testDb
      .select()
      .from(groceries)
      .where(eq(groceries.id, groceryB));

    return { ingredientRows, stepRows, groceryRows };
  }

  it("leaves the OTHER cookbook's rows byte-identical when one recipe is re-derived", async () => {
    const before = await snapshotOf(recipeB);

    expect(before.ingredientRows.length).toBeGreaterThan(0);
    expect(before.stepRows.length).toBeGreaterThan(0);

    await db.transaction((tx) =>
      deriveProjectionTx(tx, {
        recipeId: recipeA,
        systemUsed: "metric",
        cookTokens: tokens(999),
        units,
      })
    );

    const after = await snapshotOf(recipeB);

    // Ids, amounts, `version` AND `updated_at` — an unscoped UPDATE moves the last
    // two even when the row's user-visible values happen to match.
    expect(after).toEqual(before);
  });

  it("leaves the OTHER cookbook's rows intact when one recipe's ingredients are REMOVED", async () => {
    const before = await snapshotOf(recipeB);

    // The delete path is where a missing `recipe_id` predicate is most destructive.
    await db.transaction((tx) =>
      deriveProjectionTx(tx, { recipeId: recipeA, systemUsed: "metric", cookTokens: [], units })
    );

    expect(
      await getTestDb().select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeA))
    ).toHaveLength(0);

    const after = await snapshotOf(recipeB);

    expect(after).toEqual(before);
  });

  it("never nulls the OTHER cookbook's grocery FK", async () => {
    await db.transaction((tx) =>
      deriveProjectionTx(tx, { recipeId: recipeA, systemUsed: "metric", cookTokens: [], units })
    );

    const [grocery] = await getTestDb()
      .select({ recipeIngredientId: groceries.recipeIngredientId })
      .from(groceries)
      .where(eq(groceries.id, groceryB));

    expect(grocery?.recipeIngredientId).not.toBeNull();
  });

  it("writes only inside the recipe it was given", async () => {
    const testDb = getTestDb();
    const idsBefore = (
      await testDb.select({ id: recipeIngredients.id }).from(recipeIngredients)
    ).map((r) => r.id);

    await db.transaction((tx) =>
      deriveProjectionTx(tx, {
        recipeId: recipeA,
        systemUsed: "metric",
        cookTokens: tokens(123),
        units,
      })
    );

    const rowsAfter = await testDb
      .select({ id: recipeIngredients.id, recipeId: recipeIngredients.recipeId })
      .from(recipeIngredients);

    // No row changed owner, and B kept every id it had.
    const bIdsBefore = new Set(idsBefore);

    for (const row of rowsAfter.filter((r) => r.recipeId === recipeB)) {
      expect(bIdsBefore.has(row.id)).toBe(true);
    }
  });

  it("takes no household id and no user id — it cannot be told the wrong cookbook", () => {
    // Structural: `(tx, params)`. There is no ctx to get wrong, and `params` carries
    // a recipe id only. If this ever grows a household argument, the design drifted.
    expect(deriveProjectionTx.length).toBe(2);
  });
});
