// @vitest-environment node
/**
 * The W2 write path (COOK-01 / Phase 27): the optional server-authored `cook`
 * argument on `createRecipeWithRefs` / `updateRecipeWithRefs` / `copyRecipeForSave`,
 * and the two `0041` constraint fallouts that would otherwise turn a legal save
 * into a 500 (<risks> R4).
 *
 * THE HEADLINE ASSERTION is the negative one: with NO `cook` argument — which is
 * every call site that exists at the end of W2 — behaviour is unchanged and
 * `recipes.cook_source` stays NULL. W2 ships machinery, not a behaviour change.
 */

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CookTokensDTO, FullRecipeInsertDTO } from "@norish/shared/contracts";
import {
  attachIngredientsToRecipeByInputTx,
  copyRecipeForSave,
  createHousehold,
  createRecipeWithRefs,
  getRecipeFull,
  updateRecipeWithRefs,
} from "@norish/db";
import { db } from "@norish/db/drizzle";
import { recipeIngredients, recipes, steps } from "@norish/db/schema";

import { getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

const COOK_SOURCE = [
  "---",
  "title: Cooked Pancakes",
  "servings: 4",
  "norish.system: metric",
  "---",
  "Whisk the @flour{200%gram} and @milk{300%milliliter} into a batter.",
  "",
  "Fry in @butter{20%gram} until golden.",
  "",
].join("\n");

const COOK_TOKENS: CookTokensDTO = [
  {
    order: 0,
    section: null,
    tokens: [
      { type: "text", value: "Whisk the " },
      { type: "ingredient", name: "flour", amount: 200, unit: "gram" },
      { type: "text", value: " and " },
      { type: "ingredient", name: "milk", amount: 300, unit: "milliliter" },
      { type: "text", value: " into a batter." },
    ],
  },
  {
    order: 1,
    section: null,
    tokens: [
      { type: "text", value: "Fry in " },
      { type: "ingredient", name: "butter", amount: 20, unit: "gram" },
      { type: "text", value: " until golden." },
    ],
  },
];

function insertPayload(overrides: Partial<FullRecipeInsertDTO> = {}): FullRecipeInsertDTO {
  return {
    name: "Cooked Pancakes",
    servings: 4,
    systemUsed: "metric",
    recipeIngredients: [
      { ingredientId: null, ingredientName: "flour", amount: 200, unit: "gram", order: 0 },
      { ingredientId: null, ingredientName: "milk", amount: 300, unit: "milliliter", order: 1 },
    ],
    steps: [
      { step: "Whisk the flour and milk into a batter.", systemUsed: "metric", order: 0 },
      { step: "Fry in butter until golden.", systemUsed: "metric", order: 1 },
    ],
    ...overrides,
  } as FullRecipeInsertDTO;
}

describe("W2 write path — the optional server-authored `cook` argument", () => {
  const testBase = new RepositoryTestBase("cook_write_path");

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
    const household = await createHousehold({ name: "Write-path cookbook", adminUserId: userId });

    householdId = household.id;
  });

  async function ingredientRows(recipeId: string) {
    return getTestDb()
      .select({
        id: recipeIngredients.id,
        amount: recipeIngredients.amount,
        unit: recipeIngredients.unit,
        systemUsed: recipeIngredients.systemUsed,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, recipeId));
  }

  async function cookSourceOf(recipeId: string) {
    const [row] = await getTestDb()
      .select({ cookSource: recipes.cookSource })
      .from(recipes)
      .where(eq(recipes.id, recipeId));

    return row?.cookSource ?? null;
  }

  describe("with NO cook argument — behaviour is unchanged (the must_have)", () => {
    it("createRecipeWithRefs leaves cook_source NULL and writes the legacy rows", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload());

      expect(await cookSourceOf(recipeId)).toBeNull();

      const rows = await ingredientRows(recipeId);

      // The legacy path writes ONLY the authored system's rows — no derived system.
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.systemUsed === "metric")).toBe(true);

      const stepRows = await getTestDb()
        .select({ step: steps.step })
        .from(steps)
        .where(eq(steps.recipeId, recipeId));

      expect(stepRows).toHaveLength(2);
    });

    it("updateRecipeWithRefs leaves cook_source NULL", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload());
      await updateRecipeWithRefs(recipeId, userId, {
        name: "Renamed",
        recipeIngredients: [
          { ingredientId: null, ingredientName: "flour", amount: 250, unit: "gram", order: 0 },
        ],
        systemUsed: "metric",
      } as never);

      expect(await cookSourceOf(recipeId)).toBeNull();

      const rows = await ingredientRows(recipeId);

      expect(rows).toHaveLength(1);
      expect(Number(rows[0]?.amount)).toBe(250);
    });
  });

  describe("with a cook argument", () => {
    it("createRecipeWithRefs stores cook_source and derives BOTH systems", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      expect(await cookSourceOf(recipeId)).toBe(COOK_SOURCE);

      const rows = await ingredientRows(recipeId);

      // flour + milk + butter, in metric AND us.
      expect(rows.filter((r) => r.systemUsed === "metric")).toHaveLength(3);
      expect(rows.filter((r) => r.systemUsed === "us")).toHaveLength(3);

      const stepRows = await getTestDb()
        .select({ step: steps.step, systemUsed: steps.systemUsed })
        .from(steps)
        .where(eq(steps.recipeId, recipeId));

      expect(stepRows.filter((s) => s.systemUsed === "metric").map((s) => s.step)).toEqual([
        "Whisk the flour and milk into a batter.",
        "Fry in butter until golden.",
      ]);
      // Opposite-system step prose is never synthesized (D-27-W2-05).
      expect(stepRows.filter((s) => s.systemUsed === "us")).toHaveLength(0);
    });

    it("updateRecipeWithRefs replaces cook_source and re-derives the projection", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload());
      expect(await cookSourceOf(recipeId)).toBeNull();

      await updateRecipeWithRefs(recipeId, userId, { name: "Now cooked" } as never, undefined, {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      expect(await cookSourceOf(recipeId)).toBe(COOK_SOURCE);

      const rows = await ingredientRows(recipeId);

      expect(rows.filter((r) => r.systemUsed === "metric")).toHaveLength(3);
      expect(rows.filter((r) => r.systemUsed === "us")).toHaveLength(3);
    });
  });

  describe("`0041` must not turn a legal save into a 500 (<risks> R4)", () => {
    it("updateRecipeWithRefs accepts the SAME ingredient twice and writes ONE row", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload());

      const outcome = await updateRecipeWithRefs(recipeId, userId, {
        systemUsed: "metric",
        recipeIngredients: [
          { ingredientId: null, ingredientName: "egg", amount: 2, unit: "piece", order: 0 },
          { ingredientId: null, ingredientName: "egg", amount: 1, unit: "piece", order: 1 },
        ],
      } as never);

      expect(outcome.stale).toBeFalsy();

      const rows = await ingredientRows(recipeId);
      const metric = rows.filter((r) => r.systemUsed === "metric");

      expect(metric).toHaveLength(1);
      // Same unit -> the two lines SUM, matching `deriveProjectionTx`'s rule.
      expect(Number(metric[0]?.amount)).toBe(3);
    });

    it("createRecipeWithRefs accepts the SAME ingredient twice", async () => {
      const recipeId = crypto.randomUUID();

      await expect(
        createRecipeWithRefs(
          recipeId,
          userId,
          householdId,
          insertPayload({
            recipeIngredients: [
              { ingredientId: null, ingredientName: "egg", amount: 2, unit: "piece", order: 0 },
              { ingredientId: null, ingredientName: "egg", amount: 1, unit: "piece", order: 1 },
            ],
          } as Partial<FullRecipeInsertDTO>)
        )
      ).resolves.toBe(recipeId);

      expect(await ingredientRows(recipeId)).toHaveLength(1);
    });

    it("attachIngredientsToRecipeByInputTx returns the rows it wrote, never an empty list", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload());

      // The untargeted `onConflictDoNothing()` this replaced would have dropped the
      // conflicting row and then early-returned [] to a caller that saved real data.
      const attached = await db.transaction((tx) =>
        attachIngredientsToRecipeByInputTx(tx, [
          {
            recipeId,
            ingredientName: "flour",
            ingredientId: null,
            amount: 999,
            unit: "gram",
            order: 0,
            systemUsed: "metric",
          },
        ] as never)
      );

      expect(attached).toHaveLength(1);
      expect(attached[0]?.ingredientName).toBe("flour");

      // Last writer wins on the natural key rather than silently doing nothing.
      const [row] = await getTestDb()
        .select({ amount: recipeIngredients.amount })
        .from(recipeIngredients)
        .where(
          and(
            eq(recipeIngredients.recipeId, recipeId),
            eq(recipeIngredients.systemUsed, "metric"),
            eq(recipeIngredients.id, (await ingredientRows(recipeId))[0]!.id)
          )
        );

      expect(row).toBeDefined();
    });

    it("re-ordering two ingredient lines does not raise a transient unique violation", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload());

      const before = await getRecipeFull(recipeId);
      const [first, second] = before!.recipeIngredients;

      // Swap the two rows' ingredient names while keeping their ids in place — the
      // shape that would deadlock a surrogate-key writer against a non-deferrable
      // unique index.
      await expect(
        updateRecipeWithRefs(recipeId, userId, {
          systemUsed: "metric",
          recipeIngredients: [
            {
              id: first!.id,
              ingredientId: null,
              ingredientName: second!.ingredientName,
              amount: second!.amount,
              unit: second!.unit,
              order: 0,
            },
            {
              id: second!.id,
              ingredientId: null,
              ingredientName: first!.ingredientName,
              amount: first!.amount,
              unit: first!.unit,
              order: 1,
            },
          ],
        } as never)
      ).resolves.toBeDefined();

      const rows = await ingredientRows(recipeId);

      expect(rows.filter((r) => r.systemUsed === "metric")).toHaveLength(2);
    });
  });

  describe("copyRecipeForSave (SHARE-02 / §2.11)", () => {
    it("carries the .cook across and re-derives with BRAND-NEW row ids", async () => {
      const sourceId = crypto.randomUUID();

      await createRecipeWithRefs(sourceId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      const source = await getRecipeFull(sourceId);

      expect(source?.cookSource).toBe(COOK_SOURCE);

      // getRecipeFull never parses (D-27-W2-09), so hand the tokens in as the
      // read path's `withCookTokens` would have.
      const copyId = crypto.randomUUID();

      await copyRecipeForSave({ ...source!, cookTokens: COOK_TOKENS }, userId, householdId, copyId);

      expect(await cookSourceOf(copyId)).toBe(COOK_SOURCE);

      const sourceRowIds = new Set((await ingredientRows(sourceId)).map((r) => r.id));
      const copyRows = await ingredientRows(copyId);

      expect(copyRows.length).toBeGreaterThan(0);
      // Projection rows are NEVER copied raw — a grocery FK must not cross recipes.
      for (const row of copyRows) {
        expect(sourceRowIds.has(row.id)).toBe(false);
      }
    });

    it("falls back to the legacy copy when the source has no .cook", async () => {
      const sourceId = crypto.randomUUID();

      await createRecipeWithRefs(sourceId, userId, householdId, insertPayload());

      const source = await getRecipeFull(sourceId);
      const copyId = crypto.randomUUID();

      await copyRecipeForSave(source!, userId, householdId, copyId);

      expect(await cookSourceOf(copyId)).toBeNull();
      expect(await ingredientRows(copyId)).toHaveLength(2);
    });
  });
});
