// @vitest-environment node
/**
 * Phase 27 W5 (COOK-01) — `applyCookBackfill` real-Postgres proofs.
 *
 * SECURITY-CRITICAL (D-27-W5-06). `deriveProjectionTx`'s retirement DELETE scopes
 * to "every row for this recipe/these systems NOT in the kept ingredient id set",
 * and `groceries.recipe_ingredient_id` is `onDelete: "set null"` — Postgres raises
 * NOTHING when that happens. These tests prove the snapshot -> derive -> recheck ->
 * throw-and-roll-back guard actually stops that, that the sticky
 * `cook_review_needed` OR happens in SQL (D-27-W5-05), that the write never bumps
 * `updated_at`/`version` (D-27-W5-04), and that the whole thing is idempotent and
 * recipe-scoped under BOTH the `household` and `everyone` permission policies
 * (T-27-W5-04 / HOUSE-06).
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CookTokensDTO } from "@norish/shared/contracts";
import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { ServerConfigKeys } from "@norish/config/zod/server-config";
import {
  applyCookBackfill,
  createHousehold,
  getOrCreateIngredientByName,
  GroceryLinkWouldBreakError,
  setConfig,
} from "@norish/db";
import { groceries, recipeIngredients, recipes, steps } from "@norish/db/schema";

import { createTestUser, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const units = defaultUnits as UnitsMap;

function tokens(flourAmount: number, milkAmount = 300): CookTokensDTO {
  return [
    {
      order: 0,
      section: null,
      tokens: [
        { type: "text", value: "Whisk the " },
        { type: "ingredient", name: "flour", amount: flourAmount, unit: "gram" },
        { type: "text", value: " and " },
        { type: "ingredient", name: "milk", amount: milkAmount, unit: "milliliter" },
        { type: "text", value: "." },
      ],
    },
  ];
}

describe("applyCookBackfill (Phase 27 W5, COOK-01)", () => {
  const testBase = new RepositoryTestBase("cook_backfill");

  let userU: string;
  let householdA: string;
  let recipeA: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userU = user.id;
    householdA = (await createHousehold({ name: "Cookbook A", adminUserId: userU })).id;

    const testDb = getTestDb();
    const [recipe] = await testDb
      .insert(recipes)
      .values({
        userId: userU,
        householdId: householdA,
        name: "Legacy pancakes",
        systemUsed: "metric",
      })
      .returning({ id: recipes.id });

    recipeA = recipe!.id;

    // Seed legacy-shaped state directly (no `.cook`, no cook-projection writer):
    // native `recipe_ingredients` for BOTH systems, plus native `steps`, so the
    // fixture matches what a pre-W3 recipe actually holds on live.
    const flour = await getOrCreateIngredientByName("flour");
    const milk = await getOrCreateIngredientByName("milk");

    await testDb.insert(recipeIngredients).values([
      {
        recipeId: recipeA,
        ingredientId: flour.id,
        amount: "200",
        unit: "gram",
        order: "0",
        systemUsed: "metric",
      },
      {
        recipeId: recipeA,
        ingredientId: milk.id,
        amount: "300",
        unit: "milliliter",
        order: "1",
        systemUsed: "metric",
      },
      {
        recipeId: recipeA,
        ingredientId: flour.id,
        amount: "1.76",
        unit: "cup",
        order: "0",
        systemUsed: "us",
      },
      {
        recipeId: recipeA,
        ingredientId: milk.id,
        amount: "1.27",
        unit: "cup",
        order: "1",
        systemUsed: "us",
      },
    ]);

    await testDb.insert(steps).values([
      { recipeId: recipeA, step: "Whisk the flour and milk.", order: "0", systemUsed: "metric" },
    ]);
  });

  it("a grocery row points at the SAME recipe_ingredients.id after the backfill", async () => {
    const testDb = getTestDb();
    const [preRow] = await testDb
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeA))
      .orderBy(recipeIngredients.systemUsed, recipeIngredients.order);

    const [grocery] = await testDb
      .insert(groceries)
      .values({
        userId: userU,
        householdId: householdA,
        name: "flour",
        recipeIngredientId: preRow!.id,
      })
      .returning({ id: groceries.id });

    await applyCookBackfill({
      recipeId: recipeA,
      systemUsed: "metric",
      cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
      cookTokens: tokens(200),
      cookConfidence: 1,
      reviewNeeded: false,
      units,
    });

    const [after] = await testDb.select().from(groceries).where(eq(groceries.id, grocery!.id));

    expect(after!.recipeIngredientId).toBe(preRow!.id);
    expect(after!.recipeIngredientId).not.toBeNull();
  });

  it("preserves every steps.id for the native system when the step list is unchanged", async () => {
    const testDb = getTestDb();
    const before = await testDb
      .select({ id: steps.id })
      .from(steps)
      .where(eq(steps.recipeId, recipeA))
      .orderBy(steps.order);

    await applyCookBackfill({
      recipeId: recipeA,
      systemUsed: "metric",
      cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
      cookTokens: tokens(200),
      cookConfidence: 1,
      reviewNeeded: false,
      units,
    });

    const after = await testDb
      .select({ id: steps.id })
      .from(steps)
      .where(eq(steps.recipeId, recipeA))
      .orderBy(steps.order);

    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
  });

  it("running the backfill TWICE churns no id and re-flags nothing", async () => {
    const testDb = getTestDb();
    const write = {
      recipeId: recipeA,
      systemUsed: "metric" as const,
      cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
      cookTokens: tokens(200),
      cookConfidence: 0.75,
      reviewNeeded: true,
      units,
    };

    await applyCookBackfill(write);

    const ingredientIdsFirst = (
      await testDb
        .select({ id: recipeIngredients.id })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipeA))
        .orderBy(recipeIngredients.systemUsed, recipeIngredients.order)
    ).map((r) => r.id);
    const stepIdsFirst = (
      await testDb
        .select({ id: steps.id })
        .from(steps)
        .where(eq(steps.recipeId, recipeA))
        .orderBy(steps.order)
    ).map((r) => r.id);
    const [recipeFirst] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));

    await applyCookBackfill(write);

    const ingredientIdsSecond = (
      await testDb
        .select({ id: recipeIngredients.id })
        .from(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipeA))
        .orderBy(recipeIngredients.systemUsed, recipeIngredients.order)
    ).map((r) => r.id);
    const stepIdsSecond = (
      await testDb
        .select({ id: steps.id })
        .from(steps)
        .where(eq(steps.recipeId, recipeA))
        .orderBy(steps.order)
    ).map((r) => r.id);
    const [recipeSecond] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));

    expect(ingredientIdsSecond).toEqual(ingredientIdsFirst);
    expect(stepIdsSecond).toEqual(stepIdsFirst);
    expect({
      cookSource: recipeSecond!.cookSource,
      cookConfidence: recipeSecond!.cookConfidence,
      cookReviewNeeded: recipeSecond!.cookReviewNeeded,
    }).toEqual({
      cookSource: recipeFirst!.cookSource,
      cookConfidence: recipeFirst!.cookConfidence,
      cookReviewNeeded: recipeFirst!.cookReviewNeeded,
    });
  });

  it("never clears a cook_review_needed already set by 0041", async () => {
    const testDb = getTestDb();

    // Simulate `0041`'s lossy-merge branch already having flagged this recipe.
    await testDb.update(recipes).set({ cookReviewNeeded: true }).where(eq(recipes.id, recipeA));

    await applyCookBackfill({
      recipeId: recipeA,
      systemUsed: "metric",
      cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
      cookTokens: tokens(200),
      cookConfidence: 1,
      reviewNeeded: false,
      units,
    });

    const [after] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));

    expect(after!.cookReviewNeeded).toBe(true);
  });

  it("a reviewNeeded: true write sets the flag on a recipe whose flag was false", async () => {
    const testDb = getTestDb();
    const [before] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));

    expect(before!.cookReviewNeeded).toBe(false);

    await applyCookBackfill({
      recipeId: recipeA,
      systemUsed: "metric",
      cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
      cookTokens: tokens(200),
      cookConfidence: 0.667,
      reviewNeeded: true,
      units,
    });

    const [after] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));

    expect(after!.cookReviewNeeded).toBe(true);
  });

  it("does not bump recipes.updated_at or recipes.version (D-27-W5-04)", async () => {
    const testDb = getTestDb();
    const [before] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));

    await applyCookBackfill({
      recipeId: recipeA,
      systemUsed: "metric",
      cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
      cookTokens: tokens(200),
      cookConfidence: 1,
      reviewNeeded: false,
      units,
    });

    const [after] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));

    expect(after!.updatedAt).toEqual(before!.updatedAt);
    expect(after!.version).toEqual(before!.version);
  });

  it("aborts the whole recipe rather than break a shopping-list link", async () => {
    const testDb = getTestDb();

    // R1's shape: the OPPOSITE system carries an ingredient id the native system
    // does not (a pre-W3 AI-converted row named differently), and the grocery
    // link points at THAT row.
    const stray = await getOrCreateIngredientByName("brown sugar (opposite-only)");
    const [strayRow] = await testDb
      .insert(recipeIngredients)
      .values({
        recipeId: recipeA,
        ingredientId: stray.id,
        amount: "50",
        unit: "gram",
        order: "2",
        systemUsed: "us",
      })
      .returning({ id: recipeIngredients.id });

    const [grocery] = await testDb
      .insert(groceries)
      .values({
        userId: userU,
        householdId: householdA,
        name: "brown sugar",
        recipeIngredientId: strayRow!.id,
      })
      .returning({ id: groceries.id });

    await expect(
      applyCookBackfill({
        recipeId: recipeA,
        systemUsed: "metric",
        cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
        cookTokens: tokens(200), // covers only flour + milk, not the stray ingredient
        cookConfidence: 1,
        reviewNeeded: false,
        units,
      })
    ).rejects.toThrow(GroceryLinkWouldBreakError);

    const [recipeAfter] = await testDb.select().from(recipes).where(eq(recipes.id, recipeA));
    const [groceryAfter] = await testDb.select().from(groceries).where(eq(groceries.id, grocery!.id));
    const [strayAfter] = await testDb
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.id, strayRow!.id));

    expect(recipeAfter!.cookSource).toBeNull();
    expect(groceryAfter!.recipeIngredientId).toBe(strayRow!.id);
    expect(groceryAfter!.recipeIngredientId).not.toBeNull();
    expect(strayAfter).toBeDefined();
  });

  it("applyCookBackfill takes no user id and no household id", () => {
    expect(applyCookBackfill.length).toBe(1);
  });

  describe.each(["household", "everyone"] as const)(
    "recipe/cookbook isolation under view: %s",
    (view) => {
      let cookbookB: string;
      let recipeB: string;
      let groceryB: string;

      beforeEach(async () => {
        await setConfig(
          ServerConfigKeys.RECIPE_PERMISSION_POLICY,
          { view, edit: "household", delete: "household" },
          null
        );

        const userV = await createTestUser();

        cookbookB = (await createHousehold({ name: "Cookbook B", adminUserId: userV.id })).id;

        const testDb = getTestDb();
        const [recipe] = await testDb
          .insert(recipes)
          .values({
            userId: userV.id,
            householdId: cookbookB,
            name: "B pancakes",
            systemUsed: "metric",
          })
          .returning({ id: recipes.id });

        recipeB = recipe!.id;

        const flour = await getOrCreateIngredientByName("flour");
        const [bRow] = await testDb
          .insert(recipeIngredients)
          .values({
            recipeId: recipeB,
            ingredientId: flour.id,
            amount: "200",
            unit: "gram",
            order: "0",
            systemUsed: "metric",
          })
          .returning({ id: recipeIngredients.id });

        await testDb
          .insert(steps)
          .values({ recipeId: recipeB, step: "Whisk the flour.", order: "0", systemUsed: "metric" });

        const [grocery] = await testDb
          .insert(groceries)
          .values({
            userId: userV.id,
            householdId: cookbookB,
            name: "flour",
            recipeIngredientId: bRow!.id,
          })
          .returning({ id: groceries.id });

        groceryB = grocery!.id;
      });

      async function snapshotOfB() {
        const testDb = getTestDb();
        const ingredientRows = await testDb
          .select()
          .from(recipeIngredients)
          .where(eq(recipeIngredients.recipeId, recipeB))
          .orderBy(recipeIngredients.systemUsed, recipeIngredients.order);
        const stepRows = await testDb
          .select()
          .from(steps)
          .where(eq(steps.recipeId, recipeB))
          .orderBy(steps.order);
        const groceryRows = await testDb.select().from(groceries).where(eq(groceries.id, groceryB));
        // The `recipes` row itself — this is what catches an UPDATE that dropped
        // its `eq(recipes.id, recipeId)` predicate (W5-W3): such a write would set
        // cookbook B's `cook_source` / `cook_confidence` / `cook_review_needed` too,
        // even though `recipe_ingredients` and `steps` never move.
        const recipeRows = await testDb.select().from(recipes).where(eq(recipes.id, recipeB));

        return { ingredientRows, stepRows, groceryRows, recipeRows };
      }

      it("leaves cookbook B's rows byte-identical when cookbook A's recipe is backfilled", async () => {
        const before = await snapshotOfB();

        expect(before.ingredientRows.length).toBeGreaterThan(0);
        expect(before.stepRows.length).toBeGreaterThan(0);
        expect(before.recipeRows[0]!.cookSource).toBeNull();

        await applyCookBackfill({
          recipeId: recipeA,
          systemUsed: "metric",
          cookSource: "Whisk the @flour{200%gram} and @milk{300%milliliter}.\n",
          cookTokens: tokens(200),
          cookConfidence: 1,
          reviewNeeded: false,
          units,
        });

        const after = await snapshotOfB();

        expect(after).toEqual(before);
      });
    }
  );
});
