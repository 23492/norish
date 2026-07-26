// @vitest-environment node
/**
 * COOK-01 / Phase 27 — VERIFY-3 blocker 5, at the caller.
 *
 * Nutrition estimation runs on a BACKGROUND queue, moments after an import has
 * minted a recipe's `.cook`. It writes four numbers the `.cook` does not carry —
 * and it used to pass no `cook` argument at all, which `updateRecipeWithRefs` read
 * as D-27-W3-06's "NULL the stale projection". Every imported recipe that received
 * an estimate therefore lost its freshly minted `.cook`, with no error and no log.
 *
 * TWO ASSERTIONS, because the bug had two halves. The first pins the INTENT the
 * worker now states. The second pins the PAYLOAD that intent is true of: the
 * repository's `assertCookUnaffected` throws if this job ever grows a field the
 * `.cook` describes, and this test says the same thing at the call site, where a
 * reviewer widening the payload will actually be looking.
 */

import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NutritionEstimationJobData } from "../../src/contracts/job-types";

const getRecipeFull = vi.fn();
const updateRecipeWithRefs = vi.fn();
const estimateNutritionFromIngredients = vi.fn();
const createLazyWorker = vi.fn();
const emitByPolicy = vi.fn();

vi.mock("@norish/db", () => ({ getRecipeFull, updateRecipeWithRefs }));

vi.mock("@norish/queue/api-handlers", () => ({
  requireQueueApiHandler: vi.fn(() => estimateNutritionFromIngredients),
}));

vi.mock("@norish/queue/redis/bullmq", () => ({
  getBullClient: vi.fn(() => ({ duplicate: vi.fn() })),
}));

vi.mock("../../src/lazy-worker-manager", () => ({
  createLazyWorker,
  stopLazyWorker: vi.fn(),
}));

vi.mock("@norish/shared-server/realtime/policy", () => ({
  emitByPolicy,
  resolveRecipeRealtimeScope: vi.fn((_recipeId: string, fallback: unknown) =>
    Promise.resolve({ viewPolicy: "household", ctx: fallback })
  ),
}));

vi.mock("@norish/shared-server/realtime/recipes", () => ({ recipeEmitter: {} }));

vi.mock("@norish/shared-server/logger", () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";

const JOB_DATA: NutritionEstimationJobData = {
  recipeId: RECIPE_ID,
  userId: "user-1",
  householdKey: "cookbook-1",
};

/**
 * Start the worker and hand its job processor the one job this suite runs.
 * `processNutritionJob` is module-private, so it is reached the way BullMQ reaches
 * it — through `createLazyWorker` — rather than by widening the worker's exports.
 */
async function runJob(): Promise<void> {
  const { startNutritionEstimationWorker } = await import("../../src/nutrition-estimation/worker");

  await startNutritionEstimationWorker();

  const processor = createLazyWorker.mock.calls[0]![1] as (
    job: Pick<Job<NutritionEstimationJobData>, "id" | "attemptsMade" | "opts" | "data">
  ) => Promise<void>;

  await processor({ id: "job-1", attemptsMade: 0, opts: {}, data: JOB_DATA });
}

describe("nutrition estimation never deletes a recipe's `.cook`", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getRecipeFull.mockResolvedValue({
      id: RECIPE_ID,
      name: "Cooked Pancakes",
      servings: 4,
      recipeIngredients: [{ ingredientName: "flour", amount: 200, unit: "gram" }],
    });

    estimateNutritionFromIngredients.mockResolvedValue({
      success: true,
      data: { calories: 512, fat: 12.5, carbs: 60.1, protein: 18.2 },
    });

    updateRecipeWithRefs.mockResolvedValue({ stale: false });
  });

  it("states `unaffected` on the update it makes", async () => {
    await runJob();

    expect(updateRecipeWithRefs).toHaveBeenCalledTimes(1);
    expect(updateRecipeWithRefs.mock.calls[0]![4]).toEqual({ mode: "unaffected" });
  });

  it("writes ONLY fields the `.cook` does not describe", async () => {
    await runJob();

    const dto = updateRecipeWithRefs.mock.calls[0]![2] as Record<string, unknown>;

    // Exactly the four nutrition columns. `name`, `servings`, `prepMinutes`,
    // `cookMinutes`, `totalMinutes`, `url`, `systemUsed`, `recipeIngredients` and
    // `steps` are what `assertCookUnaffected` refuses — none of them belongs here.
    expect(Object.keys(dto).sort()).toEqual(["calories", "carbs", "fat", "protein"]);
  });
});
