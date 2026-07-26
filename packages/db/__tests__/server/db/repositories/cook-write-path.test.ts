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
  setActiveSystemForRecipe,
  updateRecipeWithRefs,
} from "@norish/db";
import { db } from "@norish/db/drizzle";
import { groceries, recipeIngredients, recipes, steps } from "@norish/db/schema";

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

/**
 * The unit system a stored `.cook` DECLARES, read off its `norish.system`
 * frontmatter key (D-2: one `.cook` carries exactly one system).
 *
 * Quotes are optional in the pattern on purpose: `5cdfc8aa` made every
 * non-numeric frontmatter value quoted, and this test's fixture predates that,
 * so the assertion must read both shapes rather than pin one.
 */
function declaredCookSystem(cookSource: string | null): string | null {
  return cookSource?.match(/^norish\.system: "?([a-z]+)"?\s*$/m)?.[1] ?? null;
}

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

  async function systemStateOf(recipeId: string) {
    const [row] = await getTestDb()
      .select({ systemUsed: recipes.systemUsed, cookSource: recipes.cookSource })
      .from(recipes)
      .where(eq(recipes.id, recipeId));

    return { systemUsed: row?.systemUsed ?? null, cookSource: row?.cookSource ?? null };
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
      await updateRecipeWithRefs(
        recipeId,
        userId,
        {
          name: "Renamed",
          recipeIngredients: [
            { ingredientId: null, ingredientName: "flour", amount: 250, unit: "gram", order: 0 },
          ],
          systemUsed: "metric",
        } as never,
        undefined,
        { mode: "invalidate" }
      );

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
        mode: "replace",
        cook: { cookSource: COOK_SOURCE, cookTokens: COOK_TOKENS },
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

      const outcome = await updateRecipeWithRefs(
        recipeId,
        userId,
        {
          systemUsed: "metric",
          recipeIngredients: [
            { ingredientId: null, ingredientName: "egg", amount: 2, unit: "piece", order: 0 },
            { ingredientId: null, ingredientName: "egg", amount: 1, unit: "piece", order: 1 },
          ],
        } as never,
        undefined,
        { mode: "invalidate" }
      );

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
        updateRecipeWithRefs(
          recipeId,
          userId,
          {
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
          } as never,
          undefined,
          { mode: "invalidate" }
        )
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

      // T-27-07: `cook` is now a REQUIRED argument that the CALLER must have
      // proven — the repository no longer derives it from `source`, so a stored
      // `.cook` can never ride across on trust. `@norish/db` stays parser-free, so
      // this test plays the role `revalidateCookPayload` plays in production.
      const copyId = crypto.randomUUID();

      await copyRecipeForSave(source!, userId, householdId, copyId, {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

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

      await copyRecipeForSave(source!, userId, householdId, copyId, null);

      expect(await cookSourceOf(copyId)).toBeNull();
      expect(await ingredientRows(copyId)).toHaveLength(2);
    });

    /**
     * T-27-07 — THE HOLE THIS CLOSED.
     *
     * `copyRecipeForSave` used to build its own `cook` as
     * `source.cookSource && source.cookTokens ? {...} : undefined`, so a poisoned
     * `cook_source` on the SOURCE row rode across into the copy verbatim — no
     * re-parse, no size cap, no recognizer, no bound. It was latent only because
     * `getRecipeFull` never populates `cookTokens`, which W4 changes.
     *
     * The structural fix is that `cook` is now a REQUIRED parameter the caller must
     * have proven, so there is no code path left that can derive it from `source`.
     * This test pins that: a source row carrying a poisoned `cook_source` and
     * matching tokens cannot put ANYTHING in the copy unless the caller passes it,
     * and passing `null` (what `revalidateCookPayload` returns for a source that
     * does not prove out) still produces a complete, successful copy.
     */
    it("cannot carry a POISONED source .cook across — copy lands NULL, with a full projection", async () => {
      const sourceId = crypto.randomUUID();

      // A source row whose `.cook` would never survive re-validation: 65 400 `[`
      // in frontmatter, the H1 artefact that parsed for 24 557 ms in-process.
      const poisoned = `---\na: ${"[".repeat(65_400)}\n---\nstep\n`;

      await createRecipeWithRefs(sourceId, userId, householdId, insertPayload(), {
        cookSource: poisoned,
        cookTokens: COOK_TOKENS,
      });

      const source = await getRecipeFull(sourceId);

      expect(source?.cookSource).toBe(poisoned);

      const sourceRows = await ingredientRows(sourceId);
      const copyId = crypto.randomUUID();

      // What `revalidateCookPayload` resolves for a source that does not prove out.
      const created = await copyRecipeForSave(source!, userId, householdId, copyId, null);

      // The copy SUCCEEDED and cost the user nothing...
      expect(created).toBe(copyId);
      // ...but the poison did not travel...
      expect(await cookSourceOf(copyId)).toBeNull();

      // ...and NOT ONE INGREDIENT ROW WAS LOST. This is the never-broken guarantee
      // at its sharpest: refusing the `.cook` must change what the row CARRIES, not
      // what the user SEES.
      const copyRows = await ingredientRows(copyId);

      const shapeOf = (rows: typeof sourceRows) =>
        rows.map((row) => `${row.amount}|${row.unit}|${row.systemUsed}`).sort();

      expect(sourceRows.length).toBeGreaterThan(0);
      expect(copyRows).toHaveLength(sourceRows.length);
      expect(shapeOf(copyRows)).toEqual(shapeOf(sourceRows));

      // Projection rows are never copied raw — a grocery FK must not cross recipes.
      const sourceRowIds = new Set(sourceRows.map((row) => row.id));

      for (const row of copyRows) expect(sourceRowIds.has(row.id)).toBe(false);
    });
  });

  // ------------------------------------------------------------------------
  // W3 — the first REAL producer (D-27-W3-04 / -05 / -06)
  // ------------------------------------------------------------------------

  async function stepRows(recipeId: string) {
    return getTestDb()
      .select({
        id: steps.id,
        step: steps.step,
        order: steps.order,
        systemUsed: steps.systemUsed,
      })
      .from(steps)
      .where(eq(steps.recipeId, recipeId));
  }

  describe("D-27-W3-04 — the COVERAGE GATE keeps the projection from losing rows", () => {
    /**
     * `buildCookFromExtraction` returns `null` when the model failed to reference
     * every flat ingredient (proven in
     * `packages/api/__tests__/ai/features/recipe-extraction/cook-payload.test.ts`,
     * which owns that function). What is proven HERE is the consequence the gate
     * exists for: the refusal reaches the repository as NO `cook` argument, and the
     * user keeps every ingredient row.
     */
    const ELEVEN = [
      "onion",
      "garlic",
      "olive oil",
      "minced beef",
      "chopped tomatoes",
      "tomato paste",
      "salt",
      "spaghetti",
      "parmesan",
      "basil",
      "pepper",
    ];

    it("a refused mint (8 of 11 covered) writes ALL 11 rows and leaves cook_source NULL", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(
        recipeId,
        userId,
        householdId,
        insertPayload({
          recipeIngredients: ELEVEN.map((name, order) => ({
            ingredientId: null,
            ingredientName: name,
            amount: 1,
            unit: null,
            systemUsed: "metric",
            order,
          })),
        } as never),
        // The gate refused, so the worker passes `undefined` — this IS the contract.
        undefined
      );

      expect(await cookSourceOf(recipeId)).toBeNull();

      const rows = await ingredientRows(recipeId);

      expect(rows).toHaveLength(11);
      expect(rows.every((r) => r.systemUsed === "metric")).toBe(true);
    });

    it("the sibling case (all covered) stores cook_source and derives both systems", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      expect(await cookSourceOf(recipeId)).toBe(COOK_SOURCE);

      const rows = await ingredientRows(recipeId);

      expect(rows.filter((r) => r.systemUsed === "metric")).toHaveLength(3);
      expect(rows.filter((r) => r.systemUsed === "us").length).toBeGreaterThan(0);
    });

    it("a repeated ingredient still collapses to ONE row — no fourth dedup rule (g)", async () => {
      const recipeId = crypto.randomUUID();
      const repeatedTokens: CookTokensDTO = [
        {
          order: 0,
          section: null,
          tokens: [
            { type: "text", value: "Add " },
            { type: "ingredient", name: "flour", amount: 100, unit: "gram" },
          ],
        },
        {
          order: 1,
          section: null,
          tokens: [
            { type: "text", value: "Then add the rest of the " },
            { type: "ingredient", name: "flour", amount: 100, unit: "gram" },
          ],
        },
      ];

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: repeatedTokens,
      });

      const metricRows = (await ingredientRows(recipeId)).filter((r) => r.systemUsed === "metric");

      expect(metricRows).toHaveLength(1);
    });
  });

  describe("D-27-W3-05 — the opposite system's STEP prose survives a cook create", () => {
    function dualSystemPayload() {
      return insertPayload({
        steps: [
          { step: "Whisk the flour and milk into a batter.", systemUsed: "metric", order: 0 },
          { step: "Fry in butter until golden.", systemUsed: "metric", order: 1 },
          { step: "Whisk the flour and milk into a batter.", systemUsed: "us", order: 0 },
          {
            step: "Fry in butter until golden, about 2 minutes a side.",
            systemUsed: "us",
            order: 1,
          },
        ],
      } as never);
    }

    it("keeps the AI's US steps AND derives the native metric steps from the .cook", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, dualSystemPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      const rows = await stepRows(recipeId);
      const us = rows.filter((r) => r.systemUsed === "us");
      const metric = rows.filter((r) => r.systemUsed === "metric");

      // US prose: written by the ordinary step writer, NOT by deriveProjectionTx.
      expect(us).toHaveLength(2);
      expect(us.map((r) => r.step)).toContain(
        "Fry in butter until golden, about 2 minutes a side."
      );

      // Metric prose: DERIVED from the `.cook`, so it carries the projected text.
      expect(metric).toHaveLength(2);
      expect(metric.some((r) => r.step.includes("Whisk the flour"))).toBe(true);
    });

    it("leaves convertMeasurements able to short-circuit (D-27-W2-06)", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, dualSystemPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      const full = await getRecipeFull(recipeId);

      // `hasTargetSystemProjection` (packages/trpc/src/routers/recipes/helpers.ts)
      // requires BOTH target-system ingredients and target-system steps. Asserted
      // here on the DB rows, because `@norish/db` cannot import `@norish/trpc`.
      // Without D-27-W3-05 the second half of this predicate would be FALSE and
      // every new import would pay for an AI conversion on the first toggle.
      expect(full!.recipeIngredients.some((ri) => ri.systemUsed === "us")).toBe(true);
      expect(full!.steps.some((s) => s.systemUsed === "us")).toBe(true);
    });

    it("writes no opposite-system steps when the payload has none", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      const rows = await stepRows(recipeId);

      expect(rows.filter((r) => r.systemUsed === "us")).toHaveLength(0);
      expect(rows.filter((r) => r.systemUsed === "metric")).toHaveLength(2);
    });
  });

  describe("D-27-W3-06 — an ordinary update NULLs a stale cook_source", () => {
    it("import with a .cook, then update with NO cook, leaves cook_source NULL", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      expect(await cookSourceOf(recipeId)).toBe(COOK_SOURCE);

      await updateRecipeWithRefs(
        recipeId,
        userId,
        {
          name: "Edited by hand",
          systemUsed: "metric",
          recipeIngredients: [
            { ingredientId: null, ingredientName: "flour", amount: 250, unit: "gram", order: 0 },
          ],
        } as never,
        undefined,
        { mode: "invalidate" }
      );

      // The invariant W4's renderer and W6's `0043` stand on: a non-NULL
      // cook_source always DESCRIBES the recipe it is attached to.
      expect(await cookSourceOf(recipeId)).toBeNull();

      const full = await getRecipeFull(recipeId);

      expect(full?.cookSource ?? null).toBeNull();
    });

    it("an update WITH a cook stores the NEW one (the sibling)", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      const nextSource = COOK_SOURCE.replace("Cooked Pancakes", "Cooked Pancakes v2");

      await updateRecipeWithRefs(
        recipeId,
        userId,
        { name: "Cooked Pancakes v2", systemUsed: "metric" } as never,
        undefined,
        { mode: "replace", cook: { cookSource: nextSource, cookTokens: COOK_TOKENS } }
      );

      expect(await cookSourceOf(recipeId)).toBe(nextSource);
    });
  });

  describe("VERIFY-3 blocker 5 — a write the `.cook` does not describe must KEEP it", () => {
    it("a nutrition-only update does not delete cook_source", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      expect(await cookSourceOf(recipeId)).toBe(COOK_SOURCE);

      // EXACTLY the payload `packages/queue/src/nutrition-estimation/worker.ts`
      // sends: four nutrition fields, none of which the `.cook` carries.
      await updateRecipeWithRefs(
        recipeId,
        userId,
        {
          calories: 512,
          fat: "12.5",
          carbs: "60.1",
          protein: "18.2",
        } as never,
        undefined,
        { mode: "unaffected" }
      );

      expect(await cookSourceOf(recipeId)).toBe(COOK_SOURCE);
    });

    it("refuses an `unaffected` claim that rewrites what the `.cook` DOES describe", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      await expect(
        updateRecipeWithRefs(
          recipeId,
          userId,
          {
            calories: 512,
            name: "Renamed while claiming nothing changed",
            recipeIngredients: [
              { ingredientId: null, ingredientName: "flour", amount: 250, unit: "gram", order: 0 },
            ],
          } as never,
          undefined,
          { mode: "unaffected" }
        )
      ).rejects.toThrow(/unaffected.*name, recipeIngredients/);

      // It throws BEFORE the transaction opens, so the row is untouched.
      expect(await cookSourceOf(recipeId)).toBe(COOK_SOURCE);
      expect((await getRecipeFull(recipeId))?.name).toBe("Cooked Pancakes");
    });
  });

  describe("VERIFY-3 blocker 6 — a stored `.cook` never describes the WRONG system", () => {
    it("a metric -> US switch leaves no metric `.cook` on a US recipe", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      expect(declaredCookSystem(await cookSourceOf(recipeId))).toBe("metric");

      await setActiveSystemForRecipe(recipeId, "us");

      const row = await systemStateOf(recipeId);

      // THE INVARIANT: whatever `recipes.system_used` says, a non-NULL
      // `cook_source` must not claim the other system.
      expect({
        systemUsed: row.systemUsed,
        cookSystem: declaredCookSystem(row.cookSource),
      }).toEqual({ systemUsed: "us", cookSystem: null });
    });

    it("a switch to the system the `.cook` is already written in KEEPS it", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      await setActiveSystemForRecipe(recipeId, "metric");

      const row = await systemStateOf(recipeId);

      expect({ systemUsed: row.systemUsed, cookSource: row.cookSource }).toEqual({
        systemUsed: "metric",
        cookSource: COOK_SOURCE,
      });
    });
  });

  describe("R4 — the shopping list keeps its 'from recipe X' link (the Phase 25 lesson)", () => {
    it("re-deriving with an updated cook preserves recipe_ingredients.id and the FK", async () => {
      const recipeId = crypto.randomUUID();

      await createRecipeWithRefs(recipeId, userId, householdId, insertPayload(), {
        cookSource: COOK_SOURCE,
        cookTokens: COOK_TOKENS,
      });

      const before = (await ingredientRows(recipeId)).filter((r) => r.systemUsed === "metric");
      const anchor = before[0]!;

      const [grocery] = await getTestDb()
        .insert(groceries)
        .values({
          householdId,
          userId,
          recipeIngredientId: anchor.id,
          name: "flour",
          amount: "200",
          unit: "gram",
        })
        .returning({ id: groceries.id });

      // A re-derive with a CHANGED amount on the same ingredient.
      const updatedTokens: CookTokensDTO = COOK_TOKENS.map((step) => ({
        ...step,
        tokens: step.tokens.map((token) =>
          token.type === "ingredient" && token.name === "flour" ? { ...token, amount: 250 } : token
        ),
      })) as CookTokensDTO;

      await updateRecipeWithRefs(
        recipeId,
        userId,
        { name: "Cooked Pancakes", systemUsed: "metric" } as never,
        undefined,
        { mode: "replace", cook: { cookSource: COOK_SOURCE, cookTokens: updatedTokens } }
      );

      const after = (await ingredientRows(recipeId)).filter((r) => r.systemUsed === "metric");
      const sameRow = after.find((r) => r.id === anchor.id);

      // UPSERT-stable on the natural key: the id survives, so the grocery FK does.
      expect(sameRow).toBeDefined();
      expect(Number(sameRow!.amount)).toBe(250);

      const [groceryAfter] = await getTestDb()
        .select({ recipeIngredientId: groceries.recipeIngredientId })
        .from(groceries)
        .where(eq(groceries.id, grocery!.id));

      expect(groceryAfter?.recipeIngredientId).toBe(anchor.id);
    });
  });
});
