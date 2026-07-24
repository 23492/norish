// @vitest-environment node
/**
 * `deriveProjectionTx` — the derived Cooklang projection (COOK-01 / Phase 27 W2).
 *
 * Runs against a real testcontainers Postgres so `0041`'s unique index on
 * `(recipe_id, system_used, ingredient_id)` is actually in force: a projection
 * writer that is not UPSERT-stable does not merely lose ids here, it RAISES.
 *
 * The keystone assertion is the FK-preservation regression (§2.5, the Phase 25
 * lesson): a recipe edit must not null a household's `groceries.recipe_ingredient_id`.
 */

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CookTokensDTO } from "@norish/shared/contracts";
import type { UnitsMap } from "@norish/config/zod/server-config";
import defaultUnits from "@norish/config/units.default.json";
import { createHousehold, deriveProjectionTx } from "@norish/db";
import { db } from "@norish/db/drizzle";
import { computeCookProjection } from "@norish/db/repositories/cook-projection";
import { groceries, recipeIngredients, recipes, stepImages, steps } from "@norish/db/schema";

import { getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const units = defaultUnits as UnitsMap;

/** Build a one-step token list from `(name, amount, unit)` triples. */
function tokensFor(
  ingredients: Array<{ name: string; amount: number | null; unit: string | null }>,
  options: { prose?: string; section?: string | null } = {}
): CookTokensDTO {
  const tokens: CookTokensDTO[number]["tokens"] = [
    { type: "text", value: options.prose ?? "Combine " },
  ];

  for (const ingredient of ingredients) {
    tokens.push({
      type: "ingredient",
      name: ingredient.name,
      amount: ingredient.amount,
      unit: ingredient.unit,
    });
    tokens.push({ type: "text", value: " " });
  }

  return [{ order: 0, section: options.section ?? null, tokens }];
}

describe("deriveProjectionTx (COOK-01 / W2)", () => {
  const testBase = new RepositoryTestBase("cook_projection");

  let userId: string;
  let householdId: string;
  let recipeId: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userId = user.id;
    const household = await createHousehold({ name: "Projection cookbook", adminUserId: userId });

    householdId = household.id;

    const [recipe] = await getTestDb()
      .insert(recipes)
      .values({ userId, householdId, name: "Projected recipe", systemUsed: "metric" })
      .returning({ id: recipes.id });

    recipeId = recipe!.id;
  });

  /** Drive the repository exactly as the write path does: inside a transaction. */
  async function derive(cookTokens: CookTokensDTO, systemUsed: "metric" | "us" = "metric") {
    return db.transaction((tx) =>
      deriveProjectionTx(tx, { recipeId, systemUsed, cookTokens, units })
    );
  }

  async function ingredientRows(id: string = recipeId) {
    return getTestDb()
      .select({
        id: recipeIngredients.id,
        ingredientId: recipeIngredients.ingredientId,
        amount: recipeIngredients.amount,
        unit: recipeIngredients.unit,
        order: recipeIngredients.order,
        systemUsed: recipeIngredients.systemUsed,
        version: recipeIngredients.version,
        updatedAt: recipeIngredients.updatedAt,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, id))
      .orderBy(recipeIngredients.systemUsed, recipeIngredients.order);
  }

  async function stepRows(id: string = recipeId, system: "metric" | "us" = "metric") {
    return getTestDb()
      .select({
        id: steps.id,
        step: steps.step,
        order: steps.order,
        systemUsed: steps.systemUsed,
        version: steps.version,
      })
      .from(steps)
      .where(and(eq(steps.recipeId, id), eq(steps.systemUsed, system)))
      .orderBy(steps.order);
  }

  describe("the pure row computation", () => {
    it("is deterministic — same tokens and units produce identical rows", () => {
      const cookTokens = tokensFor([
        { name: "flour", amount: 200, unit: "gram" },
        { name: "milk", amount: 300, unit: "milliliter" },
      ]);
      const a = computeCookProjection({ systemUsed: "metric", cookTokens, units });
      const b = computeCookProjection({ systemUsed: "metric", cookTokens, units });

      expect(a).toEqual(b);
    });

    it("does not mutate its input tokens", () => {
      const cookTokens = tokensFor([{ name: "flour", amount: 200, unit: "gram" }]);
      const snapshot = structuredClone(cookTokens);

      computeCookProjection({ systemUsed: "metric", cookTokens, units });

      expect(cookTokens).toEqual(snapshot);
    });

    it("re-normalizes a raw unit alternate to its canonical id (D-8)", () => {
      const projection = computeCookProjection({
        systemUsed: "metric",
        cookTokens: tokensFor([{ name: "flour", amount: 200, unit: "gr" }]),
        units,
      });

      expect(projection.native[0]?.unit).toBe("gram");
    });
  });

  describe("both measurement systems (D-27-W2-05)", () => {
    it("writes rows for BOTH systems for every ingredient after one call", async () => {
      const report = await derive(
        tokensFor([
          { name: "flour", amount: 200, unit: "gram" },
          { name: "salt", amount: null, unit: null },
        ])
      );

      expect(report.ingredientRowsNative).toBe(2);
      expect(report.ingredientRowsDerived).toBe(2);

      const rows = await ingredientRows();

      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r.systemUsed === "metric")).toHaveLength(2);
      expect(rows.filter((r) => r.systemUsed === "us")).toHaveLength(2);
    });

    it("converts a convertible measure into the opposite system", async () => {
      await derive(tokensFor([{ name: "flour", amount: 200, unit: "gram" }]));

      const rows = await ingredientRows();
      const metric = rows.find((r) => r.systemUsed === "metric");
      const us = rows.find((r) => r.systemUsed === "us");

      expect(Number(metric?.amount)).toBe(200);
      expect(metric?.unit).toBe("gram");
      // 200 g -> ounces (same dimension, no density needed).
      expect(us?.unit).toBe("ounce");
      expect(Number(us?.amount)).toBeGreaterThan(6);
      expect(Number(us?.amount)).toBeLessThan(8);
    });

    it("converts a VOLUME within its own dimension — no density is ever invented", async () => {
      // The metric/US projection is a SAME-DIMENSION conversion by design
      // (`convertToSystem`): 250 ml of an ingredient with no density entry still
      // converts to a US VOLUME. It is never turned into a weight, which is exactly
      // what "a density is never invented" means here. Cross-dimension
      // volume<->weight is `convertToUnit`'s job and the projection does not use it.
      await derive(tokensFor([{ name: "unobtainium puree", amount: 250, unit: "milliliter" }]));

      const rows = await ingredientRows();
      const metric = rows.find((r) => r.systemUsed === "metric");
      const us = rows.find((r) => r.systemUsed === "us");

      expect(Number(metric?.amount)).toBe(250);
      expect(metric?.unit).toBe("milliliter");
      expect(["cup", "tablespoon", "teaspoon"]).toContain(us?.unit);
    });

    it("FLAGS and PRESERVES the native measure when there is no quantity to convert", async () => {
      const report = await derive(
        tokensFor([{ name: "unobtainium puree", amount: null, unit: "milliliter" }])
      );

      expect(report.flagged).toContainEqual({
        ingredient: "unobtainium puree",
        reason: "no-quantity",
      });

      const rows = await ingredientRows();
      const metric = rows.find((r) => r.systemUsed === "metric");
      const us = rows.find((r) => r.systemUsed === "us");

      // Flag-and-preserve: the opposite-system row carries the NATIVE measure
      // verbatim rather than a fabricated one, and the write still succeeds.
      expect(metric?.amount).toBeNull();
      expect(metric?.unit).toBe("milliliter");
      expect(us?.amount).toBeNull();
      expect(us?.unit).toBe("milliliter");
    });

    it("leaves a descriptive/count unit system-neutral and unflagged", async () => {
      const report = await derive(tokensFor([{ name: "egg", amount: 2, unit: "piece" }]));

      const rows = await ingredientRows();

      expect(rows.every((r) => r.unit === "piece")).toBe(true);
      expect(rows.every((r) => Number(r.amount) === 2)).toBe(true);
      expect(report.flagged).toEqual([]);
    });

    it("writes step rows for the NATIVE system only", async () => {
      await derive(tokensFor([{ name: "flour", amount: 200, unit: "gram" }]));

      expect(await stepRows(recipeId, "metric")).toHaveLength(1);
      expect(await stepRows(recipeId, "us")).toHaveLength(0);
    });
  });

  describe("duplicate ingredient tokens", () => {
    it("SUMS two refs to the same ingredient when their units match", async () => {
      const report = await derive(
        tokensFor([
          { name: "sugar", amount: 100, unit: "gram" },
          { name: "sugar", amount: 50, unit: "gram" },
        ])
      );

      expect(report.ingredientRowsNative).toBe(1);

      const rows = await ingredientRows();
      const metric = rows.filter((r) => r.systemUsed === "metric");

      expect(metric).toHaveLength(1);
      expect(Number(metric[0]?.amount)).toBe(150);
    });

    it("keeps the FIRST occurrence and reports mixed-units when the units differ", async () => {
      const report = await derive(
        tokensFor([
          { name: "sugar", amount: 100, unit: "gram" },
          { name: "sugar", amount: 2, unit: "tablespoon" },
        ])
      );

      const rows = await ingredientRows();
      const metric = rows.filter((r) => r.systemUsed === "metric");

      expect(metric).toHaveLength(1);
      expect(Number(metric[0]?.amount)).toBe(100);
      expect(metric[0]?.unit).toBe("gram");
      expect(report.flagged).toContainEqual({ ingredient: "sugar", reason: "mixed-units" });
    });

    it("never lets the unique index raise on a duplicate", async () => {
      await expect(
        derive(
          tokensFor([
            { name: "egg", amount: 2, unit: null },
            { name: "Egg", amount: 1, unit: null },
          ])
        )
      ).resolves.toBeDefined();
    });
  });

  describe("UPSERT stability — the grocery FK regression (§2.5)", () => {
    it("keeps recipe_ingredients.id and the grocery FK across a re-derive", async () => {
      await derive(
        tokensFor([
          { name: "flour", amount: 200, unit: "gram" },
          { name: "milk", amount: 300, unit: "milliliter" },
        ])
      );

      const before = await ingredientRows();
      const flourBefore = before.find((r) => r.systemUsed === "metric" && Number(r.amount) === 200);

      expect(flourBefore).toBeDefined();

      const [grocery] = await getTestDb()
        .insert(groceries)
        .values({
          userId,
          householdId,
          name: "flour",
          recipeIngredientId: flourBefore!.id,
        })
        .returning({ id: groceries.id });

      // Edit: the SAME ingredients, one amount changed.
      await derive(
        tokensFor([
          { name: "flour", amount: 350, unit: "gram" },
          { name: "milk", amount: 300, unit: "milliliter" },
        ])
      );

      const after = await ingredientRows();
      const flourAfter = after.find((r) => r.id === flourBefore!.id);

      expect(flourAfter).toBeDefined();
      expect(Number(flourAfter?.amount)).toBe(350);
      expect(flourAfter?.version).toBeGreaterThan(flourBefore!.version);

      const [link] = await getTestDb()
        .select({ recipeIngredientId: groceries.recipeIngredientId })
        .from(groceries)
        .where(eq(groceries.id, grocery!.id));

      expect(link?.recipeIngredientId).not.toBeNull();
      expect(link?.recipeIngredientId).toBe(flourBefore!.id);
    });

    it("nulls the grocery FK only when the ingredient is REMOVED (today's behaviour)", async () => {
      await derive(
        tokensFor([
          { name: "flour", amount: 200, unit: "gram" },
          { name: "milk", amount: 300, unit: "milliliter" },
        ])
      );

      const before = await ingredientRows();
      const flour = before.find((r) => r.systemUsed === "metric" && Number(r.amount) === 200);
      const [grocery] = await getTestDb()
        .insert(groceries)
        .values({ userId, householdId, name: "flour", recipeIngredientId: flour!.id })
        .returning({ id: groceries.id });

      await derive(tokensFor([{ name: "milk", amount: 300, unit: "milliliter" }]));

      const after = await ingredientRows();

      expect(after.find((r) => r.id === flour!.id)).toBeUndefined();

      const [link] = await getTestDb()
        .select({ recipeIngredientId: groceries.recipeIngredientId })
        .from(groceries)
        .where(eq(groceries.id, grocery!.id));

      expect(link?.recipeIngredientId).toBeNull();
    });
  });

  describe("step id / step image preservation (<risks> R5)", () => {
    it("keeps every steps.id and step_images.step_id across a prose-only re-derive", async () => {
      const twoSteps: CookTokensDTO = [
        {
          order: 0,
          section: null,
          tokens: [
            { type: "text", value: "Whisk the " },
            { type: "ingredient", name: "flour", amount: 200, unit: "gram" },
            { type: "text", value: "." },
          ],
        },
        {
          order: 1,
          section: null,
          tokens: [{ type: "text", value: "Rest for ten minutes." }],
        },
      ];

      await derive(twoSteps);

      const before = await stepRows();

      expect(before).toHaveLength(2);

      const [image] = await getTestDb()
        .insert(stepImages)
        .values({ stepId: before[0]!.id, image: "/recipes/x/step-0.jpg", order: "0" })
        .returning({ id: stepImages.id, stepId: stepImages.stepId });

      const edited: CookTokensDTO = [
        {
          order: 0,
          section: null,
          tokens: [
            { type: "text", value: "Gently whisk the " },
            { type: "ingredient", name: "flour", amount: 200, unit: "gram" },
            { type: "text", value: " until smooth." },
          ],
        },
        {
          order: 1,
          section: null,
          tokens: [{ type: "text", value: "Rest for fifteen minutes." }],
        },
      ];

      await derive(edited);

      const after = await stepRows();

      expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
      expect(after[0]?.step).toBe("Gently whisk the flour until smooth.");

      const [survivingImage] = await getTestDb()
        .select({ id: stepImages.id, stepId: stepImages.stepId })
        .from(stepImages)
        .where(eq(stepImages.id, image!.id));

      expect(survivingImage?.stepId).toBe(before[0]!.id);
    });

    it("trims surplus step rows from the tail", async () => {
      const three: CookTokensDTO = [0, 1, 2].map((order) => ({
        order,
        section: null,
        tokens: [{ type: "text" as const, value: `Step number ${order}.` }],
      }));

      await derive(three);
      expect(await stepRows()).toHaveLength(3);

      await derive(three.slice(0, 1));

      const after = await stepRows();

      expect(after).toHaveLength(1);
      expect(after[0]?.step).toBe("Step number 0.");
    });
  });

  describe("section headings", () => {
    it("emits a `#`-prefixed step row at a section boundary and keeps prose clean", async () => {
      const cookTokens: CookTokensDTO = [
        {
          order: 0,
          section: "Dough",
          tokens: [
            { type: "text", value: "Mix the " },
            { type: "ingredient", name: "flour", amount: 200, unit: "gram" },
            { type: "text", value: "." },
          ],
        },
        {
          order: 1,
          section: "Bake",
          tokens: [{ type: "text", value: "Bake until golden." }],
        },
      ];

      await derive(cookTokens);

      const rows = await stepRows();

      expect(rows.map((r) => r.step)).toEqual([
        "# Dough",
        "Mix the flour.",
        "# Bake",
        "Bake until golden.",
      ]);
      // The section name must never leak into the following step's prose.
      expect(rows[1]?.step).not.toContain("Dough");
      expect(rows[3]?.step).not.toContain("Bake until golden.Bake");
    });

    it("does not repeat the heading while the section is unchanged", async () => {
      const cookTokens: CookTokensDTO = [
        { order: 0, section: "Dough", tokens: [{ type: "text", value: "First." }] },
        { order: 1, section: "Dough", tokens: [{ type: "text", value: "Second." }] },
      ];

      await derive(cookTokens);

      const rows = await stepRows();

      expect(rows.map((r) => r.step)).toEqual(["# Dough", "First.", "Second."]);
    });
  });

  describe("scoping — a derive touches exactly one recipe", () => {
    it("leaves another recipe's ingredient and step rows untouched", async () => {
      const [other] = await getTestDb()
        .insert(recipes)
        .values({ userId, householdId, name: "Untouched recipe", systemUsed: "metric" })
        .returning({ id: recipes.id });

      // Give the OTHER recipe an IDENTICAL ingredient set, so an unscoped
      // statement would visibly move its rows.
      await db.transaction((tx) =>
        deriveProjectionTx(tx, {
          recipeId: other!.id,
          systemUsed: "metric",
          cookTokens: tokensFor([{ name: "flour", amount: 200, unit: "gram" }]),
          units,
        })
      );

      const otherBefore = await ingredientRows(other!.id);
      const otherStepsBefore = await stepRows(other!.id);

      expect(otherBefore.length).toBeGreaterThan(0);

      await derive(
        tokensFor([
          { name: "flour", amount: 999, unit: "gram" },
          { name: "butter", amount: 30, unit: "gram" },
        ])
      );

      const otherAfter = await ingredientRows(other!.id);
      const otherStepsAfter = await stepRows(other!.id);

      expect(otherAfter).toEqual(otherBefore);
      expect(otherStepsAfter).toEqual(otherStepsBefore);
    });

    it("leaves the recipe's OTHER-system step rows alone", async () => {
      const db2 = getTestDb();

      await db2
        .insert(steps)
        .values({ recipeId, step: "US prose written earlier", order: "0", systemUsed: "us" });

      const usBefore = await stepRows(recipeId, "us");

      await derive(tokensFor([{ name: "flour", amount: 200, unit: "gram" }]));

      expect(await stepRows(recipeId, "us")).toEqual(usBefore);
    });
  });

  describe("empty input", () => {
    it("clears both systems' ingredient rows and every native step row", async () => {
      await derive(tokensFor([{ name: "flour", amount: 200, unit: "gram" }]));
      expect((await ingredientRows()).length).toBeGreaterThan(0);

      const report = await derive([]);

      expect(report.ingredientRowsNative).toBe(0);
      expect(await ingredientRows()).toHaveLength(0);
      expect(await stepRows()).toHaveLength(0);
    });
  });

  it("issues no statement that could reach another recipe (no ctx, no household)", async () => {
    // Structural proof: the function signature takes neither a user nor a household.
    expect(deriveProjectionTx.length).toBe(2);

    const rows = await getTestDb().execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM recipe_ingredients WHERE recipe_id <> ${recipeId}`
    );

    expect(rows.rows[0]?.count).toBe(0);
  });
});
