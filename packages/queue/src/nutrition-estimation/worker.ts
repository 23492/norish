/**
 * Nutrition Estimation Worker
 *
 * Processes nutrition estimation jobs from the queue.
 * Uses lazy worker pattern - starts on-demand and pauses when idle.
 */

import type { Job } from "bullmq";

import type { NutritionEstimationJobData } from "@norish/queue/contracts/job-types";
import { getRecipeFull, updateRecipeWithRefs } from "@norish/db";
import { requireQueueApiHandler } from "@norish/queue/api-handlers";
import { getBullClient } from "@norish/queue/redis/bullmq";
import { createLogger } from "@norish/shared-server/logger";
import { emitByPolicy, resolveRecipeRealtimeScope } from "@norish/shared-server/realtime/policy";
import { recipeEmitter } from "@norish/shared-server/realtime/recipes";

import { baseWorkerOptions, QUEUE_NAMES, STALLED_INTERVAL, WORKER_CONCURRENCY } from "../config";
import { createLazyWorker, stopLazyWorker } from "../lazy-worker-manager";

const log = createLogger("worker:nutrition-estimation");

async function processNutritionJob(job: Job<NutritionEstimationJobData>): Promise<void> {
  const estimateNutritionFromIngredients = requireQueueApiHandler(
    "estimateNutritionFromIngredients"
  );
  const { recipeId, userId, householdKey } = job.data;

  log.info(
    { jobId: job.id, recipeId, attempt: job.attemptsMade + 1 },
    "Processing nutrition estimation job"
  );

  // REALTIME-ISO-01 (D-22-02): scope resolves from the recipe's OWN cookbook, not the
  // server-wide default and not the actor's active cookbook. Resolved once per job.
  const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(recipeId, {
    userId,
    householdKey,
  });

  const recipe = await getRecipeFull(recipeId);

  if (!recipe) {
    throw new Error(`Recipe not found: ${recipeId}`);
  }

  if (recipe.recipeIngredients.length === 0) {
    throw new Error("Recipe has no ingredients to estimate from");
  }

  const ingredients = recipe.recipeIngredients.map((ri) => ({
    ingredientName: ri.ingredientName,
    amount: ri.amount,
    unit: ri.unit,
  }));

  const result = await estimateNutritionFromIngredients(
    recipe.name,
    recipe.servings ?? 1,
    ingredients
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  const estimate = result.data;

  // Update recipe with estimated nutrition
  await updateRecipeWithRefs(recipe.id, userId, {
    calories: estimate.calories,
    fat: estimate.fat.toString(),
    carbs: estimate.carbs.toString(),
    protein: estimate.protein.toString(),
  });

  // Fetch updated recipe and emit event
  const updatedRecipe = await getRecipeFull(recipe.id);

  if (updatedRecipe) {
    log.info({ jobId: job.id, recipeId }, "Nutrition estimated and saved");

    emitByPolicy(recipeEmitter, viewPolicy, ctx, "updated", { recipe: updatedRecipe });
  }
}

async function handleJobFailed(
  job: Job<NutritionEstimationJobData> | undefined,
  error: Error
): Promise<void> {
  if (!job) return;

  const { recipeId, userId, householdKey } = job.data;
  const maxAttempts = job.opts.attempts ?? 3;
  const isFinalFailure = job.attemptsMade >= maxAttempts;

  log.error(
    {
      jobId: job.id,
      recipeId,
      attempt: job.attemptsMade,
      maxAttempts,
      isFinalFailure,
      error: error.message,
    },
    "Nutrition estimation job failed"
  );

  if (isFinalFailure) {
    // Emit failed event with recipeId to clear loading state
    const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(recipeId, {
      userId,
      householdKey,
    });

    emitByPolicy(recipeEmitter, viewPolicy, ctx, "failed", {
      reason: error.message || "Failed to estimate nutrition after multiple attempts",
      recipeId,
    });
  }
}

export async function startNutritionEstimationWorker(): Promise<void> {
  await createLazyWorker<NutritionEstimationJobData>(
    QUEUE_NAMES.NUTRITION_ESTIMATION,
    processNutritionJob,
    {
      connection: getBullClient(),
      ...baseWorkerOptions,
      stalledInterval: STALLED_INTERVAL[QUEUE_NAMES.NUTRITION_ESTIMATION],
      concurrency: WORKER_CONCURRENCY[QUEUE_NAMES.NUTRITION_ESTIMATION],
    },
    handleJobFailed
  );
}

export async function stopNutritionEstimationWorker(): Promise<void> {
  await stopLazyWorker(QUEUE_NAMES.NUTRITION_ESTIMATION);
}
