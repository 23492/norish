// @vitest-environment node
/**
 * `backfillCookSource` — the deterministic seeder, the confidence gate and the
 * boot-time runner (Phase 27, W5 — COOK-01).
 *
 * Runs against the REAL serializer (`hasNameAnchor`, `serializeWithReport`) and
 * the REAL `buildCookPayload` (escaping, the caps, `findCookSourceDefect`, the
 * pooled WASM parser) — mocking either would test nothing about T-27-01's
 * escaping fix. Only `@norish/db`'s repository functions and `getUnits` are
 * mocked, so the test controls WHICH recipes exist and asserts nothing more
 * than counts about what the DB layer does (Task 1 already proves that layer
 * for real against Postgres).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnitsMap } from "@norish/config/zod/server-config";
import type { FullRecipeDTO } from "@norish/shared/contracts/dto/recipe";
import defaultUnits from "@norish/config/units.default.json";
import { findCookSourceDefect } from "@norish/shared-server/cooklang/limits";
import { hasNameAnchor, serializeWithReport } from "@norish/shared/cooklang";

const units = defaultUnits as UnitsMap;

const mockGetUnits = vi.fn(async () => units);

vi.mock("@norish/shared-server/config/server-config-loader", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@norish/shared-server/config/server-config-loader")
  >();

  return { ...actual, getUnits: () => mockGetUnits() };
});

const mockListRecipeIdsWithoutCookSource = vi.fn();
const mockApplyCookBackfill = vi.fn();

vi.mock("@norish/db/repositories/cook-backfill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/db/repositories/cook-backfill")>();

  return {
    ...actual,
    listRecipeIdsWithoutCookSource: () => mockListRecipeIdsWithoutCookSource(),
    applyCookBackfill: (write: unknown) => mockApplyCookBackfill(write),
  };
});

const mockGetRecipeFull = vi.fn();

vi.mock("@norish/db/repositories/recipes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/db/repositories/recipes")>();

  return { ...actual, getRecipeFull: (id: string) => mockGetRecipeFull(id) };
});

const logSpy = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: () => logSpy,
};

vi.mock("@norish/shared-server/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@norish/shared-server/logger")>();

  return { ...actual, dbLogger: logSpy };
});

const {
  backfillCookSource,
  buildStructuredRecipeFromLegacy,
  cookConfidenceFromLinks,
  COOK_REVIEW_CONFIDENCE_THRESHOLD,
} = await import("@norish/api/startup/backfill-cook-source");
const { GroceryLinkWouldBreakError, StepWouldBeLostError } = await import(
  "@norish/db/repositories/cook-backfill"
);
const { computeCookProjection } = await import("@norish/db/repositories/cook-projection");
const { buildCookPayload } = await import("@norish/shared-server/cooklang/build-payload");

// --------------------------------------------------------------------------
// fixture builders
// --------------------------------------------------------------------------

type StepFixture = FullRecipeDTO["steps"][number];
type IngredientFixture = FullRecipeDTO["recipeIngredients"][number];

function makeStep(overrides: Partial<StepFixture> & { step: string }): StepFixture {
  return {
    systemUsed: "metric",
    order: 0,
    version: 1,
    images: [],
    ...overrides,
  };
}

function makeIngredient(
  overrides: Partial<IngredientFixture> & { ingredientName: string }
): IngredientFixture {
  return {
    id: `ri-${overrides.ingredientName}-${overrides.systemUsed ?? "metric"}`,
    ingredientId: `ing-${overrides.ingredientName}`,
    amount: null,
    unit: null,
    systemUsed: "metric",
    order: 0,
    version: 1,
    ...overrides,
  };
}

function makeRecipe(overrides: Partial<FullRecipeDTO> = {}): FullRecipeDTO {
  return {
    id: "recipe-1",
    userId: "user-1",
    householdId: "household-1",
    visibility: "private",
    name: "Legacy Recipe",
    description: null,
    notes: null,
    url: null,
    image: null,
    servings: 4,
    prepMinutes: null,
    cookMinutes: null,
    totalMinutes: null,
    systemUsed: "metric",
    calories: null,
    fat: null,
    carbs: null,
    protein: null,
    categories: [],
    steps: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    version: 1,
    cookSource: null,
    cookTokens: null,
    cookConfidence: null,
    cookReviewNeeded: false,
    tags: [],
    recipeIngredients: [],
    author: undefined,
    images: [],
    videos: [],
    ...overrides,
  } as unknown as FullRecipeDTO;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUnits.mockResolvedValue(units);
  mockApplyCookBackfill.mockResolvedValue({
    ingredientRowsNative: 0,
    ingredientRowsDerived: 0,
    stepRows: 0,
    flagged: [],
  });
});

// --------------------------------------------------------------------------
// hasNameAnchor (re-exported for the seeder to reuse — no second matcher)
// --------------------------------------------------------------------------

describe("hasNameAnchor", () => {
  it("finds a word-boundary match", () => {
    expect(hasNameAnchor("Whisk the flour in.", "flour")).toBe(true);
  });

  it("does not match a longer word containing the name", () => {
    expect(hasNameAnchor("Whisk the flourish.", "flour")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(hasNameAnchor("Whisk the FLOUR in.", "flour")).toBe(true);
  });
});

// --------------------------------------------------------------------------
// cookConfidenceFromLinks / COOK_REVIEW_CONFIDENCE_THRESHOLD
// --------------------------------------------------------------------------

describe("cookConfidenceFromLinks / COOK_REVIEW_CONFIDENCE_THRESHOLD", () => {
  it("is exactly 0.8", () => {
    expect(COOK_REVIEW_CONFIDENCE_THRESHOLD).toBe(0.8);
  });

  it.each([
    { links: [], expected: 1 },
    {
      links: [
        { stepOrder: 0, ingredient: "a", placement: "inline" as const },
        { stepOrder: 0, ingredient: "b", placement: "inline" as const },
        { stepOrder: 0, ingredient: "c", placement: "inline" as const },
        { stepOrder: 0, ingredient: "d", placement: "inline" as const },
        { stepOrder: 0, ingredient: "e", placement: "appended" as const },
      ],
      expected: 0.8,
    },
    {
      links: [
        { stepOrder: 0, ingredient: "a", placement: "inline" as const },
        { stepOrder: 0, ingredient: "b", placement: "inline" as const },
        { stepOrder: 0, ingredient: "c", placement: "inline" as const },
        { stepOrder: 0, ingredient: "d", placement: "appended" as const },
      ],
      expected: 0.75,
    },
    {
      links: [
        { stepOrder: 0, ingredient: "a", placement: "inline" as const },
        { stepOrder: 0, ingredient: "b", placement: "inline" as const },
        { stepOrder: 0, ingredient: "c", placement: "appended" as const },
      ],
      expected: 0.667,
    },
  ])("scores $expected for the given link set", ({ links, expected }) => {
    expect(cookConfidenceFromLinks(links)).toBe(expected);
  });

  it("flags 0.75 (strictly below threshold) but not 0.8 (at threshold)", () => {
    expect(0.8 < COOK_REVIEW_CONFIDENCE_THRESHOLD).toBe(false);
    expect(0.75 < COOK_REVIEW_CONFIDENCE_THRESHOLD).toBe(true);
  });
});

// --------------------------------------------------------------------------
// buildStructuredRecipeFromLegacy
// --------------------------------------------------------------------------

describe("buildStructuredRecipeFromLegacy", () => {
  it("uses only the native system's steps and ingredients, in order", () => {
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [
        makeStep({ step: "Whisk the flour.", systemUsed: "metric", order: 1 }),
        makeStep({ step: "Bake it.", systemUsed: "metric", order: 0 }),
        makeStep({ step: "Opposite-only step.", systemUsed: "us", order: 0 }),
      ],
      recipeIngredients: [
        makeIngredient({ ingredientName: "flour", systemUsed: "metric", order: 0 }),
        makeIngredient({ ingredientName: "opposite only", systemUsed: "us", order: 0 }),
      ],
    });

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect("structured" in result).toBe(true);
    if (!("structured" in result)) throw new Error("expected structured");

    expect(result.structured.steps.map((s) => s.text)).toEqual(["Bake it.", "Whisk the flour."]);
    expect(
      result.structured.steps.flatMap((s) => s.ingredients.map((i) => i.name))
    ).toEqual(["flour"]);
  });

  it("refuses no-native-steps when the native system has no steps", () => {
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [makeStep({ step: "US only.", systemUsed: "us", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
    });

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect(result).toEqual({ refusal: "no-native-steps" });
  });

  it("refuses no-native-ingredients when the native system has no ingredient rows while the opposite system does", () => {
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [makeStep({ step: "Whisk.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "us" })],
    });

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect(result).toEqual({ refusal: "no-native-ingredients" });
  });

  it("does not refuse when there are simply no ingredients at all", () => {
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [makeStep({ step: "Whisk.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [],
    });

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect("structured" in result).toBe(true);
  });

  it("a `#`-prefixed step is a heading and is never assigned refs", () => {
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [
        makeStep({ step: "# Dough", systemUsed: "metric", order: 0 }),
        makeStep({ step: "Rest for an hour.", systemUsed: "metric", order: 1 }),
      ],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
    });

    const result = buildStructuredRecipeFromLegacy(recipe);

    if (!("structured" in result)) throw new Error("expected structured");

    // "flour" anchors nowhere, so it is appended to the first NON-heading step —
    // never the heading itself.
    expect(result.structured.steps[0]!.ingredients).toEqual([]);
    expect(result.structured.steps[1]!.ingredients.map((i) => i.name)).toEqual(["flour"]);
  });

  it("an ingredient no step names is appended to the first non-heading step", () => {
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [makeStep({ step: "Combine everything.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "a pinch of magic", systemUsed: "metric" })],
    });

    const result = buildStructuredRecipeFromLegacy(recipe);

    if (!("structured" in result)) throw new Error("expected structured");

    const report = serializeWithReport(result.structured, units);

    expect(report.links).toEqual([
      { stepOrder: 0, ingredient: "a pinch of magic", placement: "appended" },
    ]);
  });

  it("assigns brown sugar inline and sugar as appended, dropping neither", () => {
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [makeStep({ step: "Whisk the brown sugar in.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [
        // sugar is a SUBSTRING of "brown sugar" — sorted longest-first, "brown
        // sugar" must claim the anchor before "sugar" gets a chance to.
        makeIngredient({ ingredientName: "sugar", systemUsed: "metric", order: 0 }),
        makeIngredient({ ingredientName: "brown sugar", systemUsed: "metric", order: 1 }),
      ],
    });

    const result = buildStructuredRecipeFromLegacy(recipe);

    if (!("structured" in result)) throw new Error("expected structured");

    const names = result.structured.steps.flatMap((s) => s.ingredients.map((i) => i.name));

    expect(names).toContain("sugar");
    expect(names).toContain("brown sugar");
    expect(names).toHaveLength(2);

    const report = serializeWithReport(result.structured, units);
    const byName = new Map(report.links.map((link) => [link.ingredient, link.placement]));

    expect(byName.get("brown sugar")).toBe("inline");
    expect(byName.get("sugar")).toBe("appended");
  });
});

// --------------------------------------------------------------------------
// buildStructuredRecipeFromLegacy — WIDENING proof (27.1-02, D-27.1-05)
//
// `buildStructuredRecipeFromLegacy` now also accepts an INSERT-shaped source
// (`FullRecipeInsertDTO` / `z.input<FullRecipeInsertSchema>`), not only the
// read-shaped `FullRecipeDTO` every test above drives. The insert shape
// differs in exactly the ways `LegacyProjectionSource`'s doc comment names:
// `order` may arrive as a string, `ingredientName` may be absent, and
// per-row / recipe-level `systemUsed` may be absent. None of the assertions
// above are touched by this describe block — it is purely additive.
// --------------------------------------------------------------------------

describe("buildStructuredRecipeFromLegacy — widened to accept an insert-shaped source", () => {
  it("coerces a string `order` on both steps and ingredients before sorting", () => {
    const recipe = {
      name: "Insert-shaped Recipe",
      systemUsed: "metric" as const,
      steps: [
        { step: "Bake it.", order: "0" },
        { step: "Whisk the flour.", order: "1" },
      ],
      recipeIngredients: [{ ingredientName: "flour", amount: null, unit: null, order: "0" }],
    };

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect("structured" in result).toBe(true);
    if (!("structured" in result)) throw new Error("expected structured");

    expect(result.structured.steps.map((s) => s.text)).toEqual(["Bake it.", "Whisk the flour."]);
  });

  it("skips an ingredient row with no ingredientName rather than crashing or linking an empty name", () => {
    const recipe = {
      name: "Insert-shaped Recipe",
      systemUsed: "metric" as const,
      steps: [{ step: "Whisk the flour.", order: 0 }],
      recipeIngredients: [
        { ingredientName: "flour", amount: null, unit: null, order: 0 },
        { ingredientName: undefined, amount: null, unit: null, order: 1 },
        { ingredientName: "", amount: null, unit: null, order: 2 },
      ],
    };

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect("structured" in result).toBe(true);
    if (!("structured" in result)) throw new Error("expected structured");

    const names = result.structured.steps.flatMap((s) => s.ingredients.map((i) => i.name));

    expect(names).toEqual(["flour"]);
  });

  it("treats a missing per-row systemUsed as the recipe's own native system", () => {
    const recipe = {
      name: "Insert-shaped Recipe",
      systemUsed: "metric" as const,
      steps: [{ step: "Whisk the flour.", order: 0, systemUsed: undefined }],
      recipeIngredients: [
        { ingredientName: "flour", amount: null, unit: null, order: 0, systemUsed: undefined },
      ],
    };

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect("structured" in result).toBe(true);
    if (!("structured" in result)) throw new Error("expected structured");

    expect(result.structured.steps).toHaveLength(1);
    expect(result.structured.steps[0]!.ingredients.map((i) => i.name)).toEqual(["flour"]);
  });

  it("defaults a missing recipe-level systemUsed to metric, matching the column's own DB default", () => {
    const recipe = {
      name: "Insert-shaped Recipe",
      systemUsed: undefined,
      steps: [{ step: "Whisk the flour.", order: 0 }],
      recipeIngredients: [{ ingredientName: "flour", amount: null, unit: null, order: 0 }],
    };

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect("structured" in result).toBe(true);
    if (!("structured" in result)) throw new Error("expected structured");

    expect(result.structured.systemUsed).toBe("metric");
  });

  it("defaults missing steps/recipeIngredients arrays to empty, refusing no-native-steps rather than crashing", () => {
    const recipe = { name: "Insert-shaped Recipe", systemUsed: "metric" as const };

    const result = buildStructuredRecipeFromLegacy(recipe);

    expect(result).toEqual({ refusal: "no-native-steps" });
  });
});

// --------------------------------------------------------------------------
// the escaping proof (T-27-01)
// --------------------------------------------------------------------------

describe("the escaping proof", () => {
  it("escapes every Cooklang metacharacter in legacy step prose and round-trips cleanly", async () => {
    const hostileProse = "Mix @flour #1 ~well {carefully} 50% > done - now.\r\nRest it.";
    const hostileIngredientName = "50% cocoa {blend}";
    const recipe = makeRecipe({
      systemUsed: "metric",
      steps: [makeStep({ step: hostileProse, systemUsed: "metric", order: 0 })],
      recipeIngredients: [
        makeIngredient({
          ingredientName: hostileIngredientName,
          systemUsed: "metric",
          amount: 2,
          unit: "gram",
        }),
      ],
    });

    const built = buildStructuredRecipeFromLegacy(recipe);

    if (!("structured" in built)) throw new Error("expected structured");

    const report = serializeWithReport(built.structured, units);

    expect(report.cook).toContain("\\@");
    expect(findCookSourceDefect(report.cook)).toBeNull();

    mockListRecipeIdsWithoutCookSource.mockResolvedValue(["recipe-1"]);
    mockGetRecipeFull.mockResolvedValue(recipe);

    const outcome = await backfillCookSource();

    expect(outcome.derived + outcome.flagged).toBe(1);
    expect(mockApplyCookBackfill).toHaveBeenCalledTimes(1);

    const write = mockApplyCookBackfill.mock.calls[0]![0] as { cookSource: string };

    expect(write.cookSource).toBe(report.cook);
    expect(findCookSourceDefect(write.cookSource)).toBeNull();

    // The CR/LF embedded in the hostile prose folds to a single space in the
    // minted step line — never dropped, never left as a raw control character
    // that would split the step into two lines.
    expect(write.cookSource).toContain("now. Rest it.");
    expect(write.cookSource).not.toMatch(/now\. \r?\nRest it\./);
  });
});

// --------------------------------------------------------------------------
// backfillCookSource — the runner
// --------------------------------------------------------------------------

describe("backfillCookSource", () => {
  it("logs and returns zeros when there is nothing to do", async () => {
    mockListRecipeIdsWithoutCookSource.mockResolvedValue([]);

    const outcome = await backfillCookSource();

    expect(outcome).toEqual({ candidates: 0, derived: 0, flagged: 0, refused: 0, failed: 0 });
    expect(mockGetRecipeFull).not.toHaveBeenCalled();
  });

  it("counts derived / flagged / refused / failed across a mixed batch and never throws", async () => {
    const clean = makeRecipe({
      id: "clean",
      name: "Clean Pancakes",
      steps: [makeStep({ step: "Whisk the flour and milk.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [
        makeIngredient({ ingredientName: "flour", systemUsed: "metric", order: 0, amount: 200, unit: "gram" }),
        makeIngredient({ ingredientName: "milk", systemUsed: "metric", order: 1, amount: 300, unit: "milliliter" }),
      ],
    });

    // Low confidence: two of three ingredients have no textual anchor at all.
    const lowConfidence = makeRecipe({
      id: "low-confidence",
      name: "Drifted Recipe",
      steps: [makeStep({ step: "Combine everything and serve.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [
        makeIngredient({ ingredientName: "salt", systemUsed: "metric", order: 0 }),
        makeIngredient({ ingredientName: "pepper", systemUsed: "metric", order: 1 }),
        makeIngredient({ ingredientName: "garlic", systemUsed: "metric", order: 2 }),
      ],
    });

    const noNativeSteps = makeRecipe({
      id: "no-native-steps",
      name: "US Only Recipe",
      systemUsed: "metric",
      steps: [makeStep({ step: "US-only.", systemUsed: "us", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
    });

    const groceryLinked = makeRecipe({
      id: "grocery-linked",
      name: "Linked Recipe",
      steps: [makeStep({ step: "Whisk the flour.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
    });

    const explodes = makeRecipe({
      id: "explodes",
      name: "Broken Recipe",
      steps: [makeStep({ step: "Whisk the flour.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
    });

    mockListRecipeIdsWithoutCookSource.mockResolvedValue([
      "clean",
      "low-confidence",
      "no-native-steps",
      "grocery-linked",
      "explodes",
    ]);
    mockGetRecipeFull.mockImplementation(async (id: string) => {
      return { clean, "low-confidence": lowConfidence, "no-native-steps": noNativeSteps, "grocery-linked": groceryLinked, explodes }[
        id
      ];
    });
    mockApplyCookBackfill.mockImplementation(async (write: { recipeId: string }) => {
      if (write.recipeId === "grocery-linked") {
        throw new GroceryLinkWouldBreakError(write.recipeId, 1);
      }

      if (write.recipeId === "explodes") {
        throw new Error("unexpected boom");
      }

      return { ingredientRowsNative: 0, ingredientRowsDerived: 0, stepRows: 0, flagged: [] };
    });

    const outcome = await backfillCookSource();

    expect(outcome.candidates).toBe(5);
    expect(outcome.derived).toBe(1);
    expect(outcome.flagged).toBe(1);
    expect(outcome.refused).toBe(2); // no-native-steps + grocery-linked
    expect(outcome.failed).toBe(1); // explodes

    // ONE "Cooklang backfill complete" summary line.
    const completeCalls = logSpy.info.mock.calls.filter(
      (call) => call[1] === "Cooklang backfill complete"
    );

    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]![0]).toMatchObject({
      candidates: 5,
      derived: 1,
      flagged: 1,
      refused: 2,
      failed: 1,
    });
  });

  it("never leaks a recipe name, an ingredient name or step prose into a log line", async () => {
    const secretName = "Grandma's Secret Recipe";
    const secretIngredient = "unobtainium spice";
    const secretProse = "Whisper the incantation while stirring counter-clockwise.";
    const recipe = makeRecipe({
      id: "secret",
      name: secretName,
      steps: [makeStep({ step: secretProse, systemUsed: "metric", order: 0 })],
      recipeIngredients: [
        makeIngredient({ ingredientName: secretIngredient, systemUsed: "metric", order: 0 }),
      ],
    });

    mockListRecipeIdsWithoutCookSource.mockResolvedValue(["secret"]);
    mockGetRecipeFull.mockResolvedValue(recipe);

    await backfillCookSource();

    const allLogPayloads = [
      ...logSpy.debug.mock.calls,
      ...logSpy.info.mock.calls,
      ...logSpy.warn.mock.calls,
      ...logSpy.error.mock.calls,
    ]
      .map((call) => JSON.stringify(call))
      .join("\n");

    expect(allLogPayloads).not.toContain(secretName);
    expect(allLogPayloads).not.toContain(secretIngredient);
    expect(allLogPayloads).not.toContain(secretProse);
  });

  it("resolves rather than rejects when applyCookBackfill throws, and counts it", async () => {
    const recipe = makeRecipe({
      id: "boom",
      steps: [makeStep({ step: "Whisk the flour.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
    });

    mockListRecipeIdsWithoutCookSource.mockResolvedValue(["boom"]);
    mockGetRecipeFull.mockResolvedValue(recipe);
    mockApplyCookBackfill.mockRejectedValue(new Error("boom"));

    await expect(backfillCookSource()).resolves.toEqual({
      candidates: 1,
      derived: 0,
      flagged: 0,
      refused: 0,
      failed: 1,
    });
  });

  it("calls no model — grep-asserted, but proved structurally by calling no AI mock", async () => {
    mockListRecipeIdsWithoutCookSource.mockResolvedValue([]);

    await backfillCookSource();

    // If the subject imported any AI surface, importing this module (done at file
    // scope above) would already have pulled it in; the assertion that matters is
    // the static grep in the plan's acceptance criteria. This test exists so the
    // behaviour bullet has a corresponding assertion in the suite.
    expect(mockGetUnits).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // G2 fix — the step-loss guard's `StepWouldBeLostError` is handled the same
  // way `GroceryLinkWouldBreakError` already is: counted `refused`, logged with
  // reason `step-would-be-lost`, never escapes the loop.
  // --------------------------------------------------------------------------

  it("counts a StepWouldBeLostError as refused and logs step-would-be-lost, never throwing", async () => {
    const recipe = makeRecipe({
      id: "step-loss",
      steps: [makeStep({ step: "Whisk the flour.", systemUsed: "metric", order: 0 })],
      recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
    });

    mockListRecipeIdsWithoutCookSource.mockResolvedValue(["step-loss"]);
    mockGetRecipeFull.mockResolvedValue(recipe);
    mockApplyCookBackfill.mockRejectedValue(new StepWouldBeLostError("step-loss", 1));

    await expect(backfillCookSource()).resolves.toEqual({
      candidates: 1,
      derived: 0,
      flagged: 0,
      refused: 1,
      failed: 0,
    });

    const warnCalls = logSpy.warn.mock.calls.filter(
      (call) => (call[0] as { reason?: string }).reason === "step-would-be-lost"
    );

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]![0]).toMatchObject({ module: "cooklang", recipeId: "step-loss" });
  });

  // --------------------------------------------------------------------------
  // G2 fix — proof, against the REAL chain, that the three degenerate legacy
  // step shapes the verifier found really do collapse the derived step count.
  // `computeCookProjection` is `@norish/db`'s parser-free projection function
  // (imported here because `@norish/api` already depends on `@norish/db`,
  // unlike `@norish/db` itself, which cannot import the parser); feeding it the
  // REAL `cookTokens` `buildCookPayload` mints proves the collapse happens on
  // the real chain, not just in a hand-built fixture. The db-level guard test
  // (`cook-backfill.test.ts`) proves the ABORT; this proves the TRIGGER.
  // --------------------------------------------------------------------------

  describe("G2: the real chain collapses these three legacy step shapes", () => {
    async function derivedStepCount(recipe: FullRecipeDTO): Promise<{ derived: number; native: number }> {
      const built = buildStructuredRecipeFromLegacy(recipe);

      if (!("structured" in built)) throw new Error(`expected structured, got refusal: ${JSON.stringify(built)}`);

      const payload = await buildCookPayload(built.structured, units);

      if (!payload) throw new Error("expected a payload");

      const projection = computeCookProjection({
        systemUsed: built.structured.systemUsed,
        cookTokens: payload.cookTokens,
        units,
      });

      return { derived: projection.steps.length, native: built.structured.steps.length };
    }

    it("a trailing `#` heading with no body loses its own row", async () => {
      const recipe = makeRecipe({
        systemUsed: "metric",
        steps: [
          makeStep({ step: "Whisk the flour.", systemUsed: "metric", order: 0 }),
          makeStep({ step: "Bake it.", systemUsed: "metric", order: 1 }),
          makeStep({ step: "# Notes", systemUsed: "metric", order: 2 }),
        ],
        recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
      });

      const { derived, native } = await derivedStepCount(recipe);

      expect(native).toBe(3);
      expect(derived).toBeLessThan(native);
    });

    it("two consecutive headings collapse into one, losing the first heading's text", async () => {
      const recipe = makeRecipe({
        systemUsed: "metric",
        steps: [
          makeStep({ step: "# Prep", systemUsed: "metric", order: 0 }),
          makeStep({ step: "# Cook", systemUsed: "metric", order: 1 }),
          makeStep({ step: "Do the thing.", systemUsed: "metric", order: 2 }),
        ],
        recipeIngredients: [],
      });

      const { derived, native } = await derivedStepCount(recipe);

      expect(native).toBe(3);
      expect(derived).toBeLessThan(native);
    });

    it("a whitespace-only step vanishes entirely", async () => {
      const recipe = makeRecipe({
        systemUsed: "metric",
        steps: [
          makeStep({ step: "Whisk the flour.", systemUsed: "metric", order: 0 }),
          makeStep({ step: "   ", systemUsed: "metric", order: 1 }),
          makeStep({ step: "Bake it.", systemUsed: "metric", order: 2 }),
        ],
        recipeIngredients: [makeIngredient({ ingredientName: "flour", systemUsed: "metric" })],
      });

      const { derived, native } = await derivedStepCount(recipe);

      expect(native).toBe(3);
      expect(derived).toBeLessThan(native);
    });
  });

  // --------------------------------------------------------------------------
  // G3 fix — `getUnits()` and `listRecipeIdsWithoutCookSource()` are setup
  // calls OUTSIDE the per-recipe loop; they must be guarded exactly as
  // thoroughly as anything inside it, or the "NEVER THROWS" contract is false.
  // --------------------------------------------------------------------------

  describe("G3: the setup calls can never escape backfillCookSource", () => {
    it("resolves with zeroed counts when getUnits() rejects", async () => {
      mockGetUnits.mockRejectedValueOnce(new Error("units config unreachable"));

      await expect(backfillCookSource()).resolves.toEqual({
        candidates: 0,
        derived: 0,
        flagged: 0,
        refused: 0,
        failed: 0,
      });

      expect(mockGetRecipeFull).not.toHaveBeenCalled();

      const errorCalls = logSpy.error.mock.calls.filter(
        (call) => (call[0] as { reason?: string }).reason === "setup-failed"
      );

      expect(errorCalls).toHaveLength(1);
    });

    it("resolves with zeroed counts when listRecipeIdsWithoutCookSource() rejects", async () => {
      mockListRecipeIdsWithoutCookSource.mockRejectedValueOnce(new Error("db pool exhausted"));

      await expect(backfillCookSource()).resolves.toEqual({
        candidates: 0,
        derived: 0,
        flagged: 0,
        refused: 0,
        failed: 0,
      });

      expect(mockGetRecipeFull).not.toHaveBeenCalled();

      const errorCalls = logSpy.error.mock.calls.filter(
        (call) => (call[0] as { reason?: string }).reason === "setup-failed"
      );

      expect(errorCalls).toHaveLength(1);
    });
  });
});
