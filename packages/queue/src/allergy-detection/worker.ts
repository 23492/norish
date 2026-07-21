/**
 * Allergy Detection Worker
 *
 * Processes allergy detection jobs from the queue.
 * Detects allergens in recipes imported via structured parsers.
 * Uses lazy worker pattern - starts on-demand and pauses when idle.
 */

import type { Job } from "bullmq";

import type { AllergyDetectionJobData } from "@norish/queue/contracts/job-types";
import { getAllergiesForUsers, getHouseholdMemberIds, getRecipeFull } from "@norish/db";
import { mergeTagsIntoRecipe } from "@norish/db/repositories/tags";
import { requireQueueApiHandler } from "@norish/queue/api-handlers";
import { getBullClient } from "@norish/queue/redis/bullmq";
import { createLogger } from "@norish/shared-server/logger";
import { emitByPolicy, resolveRecipeRealtimeScope } from "@norish/shared-server/realtime/policy";
import { recipeEmitter } from "@norish/shared-server/realtime/recipes";

import { baseWorkerOptions, QUEUE_NAMES, STALLED_INTERVAL, WORKER_CONCURRENCY } from "../config";
import { createLazyWorker, stopLazyWorker } from "../lazy-worker-manager";

const log = createLogger("worker:allergy-detection");

async function processAllergyDetectionJob(job: Job<AllergyDetectionJobData>): Promise<void> {
  const detectAllergiesInRecipe = requireQueueApiHandler("detectAllergiesInRecipe");
  const { recipeId, userId, householdKey } = job.data;

  log.info(
    { jobId: job.id, recipeId, attempt: job.attemptsMade + 1 },
    "Processing allergy detection job"
  );

  // REALTIME-ISO-01 (D-22-02): scope resolves from the recipe's OWN cookbook, not the
  // server-wide default and not the actor's active cookbook. Resolved once per job.
  const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(recipeId, {
    userId,
    householdKey,
  });

  // Emit allergyDetectionStarted event so clients can show loading state
  emitByPolicy(recipeEmitter, viewPolicy, ctx, "allergyDetectionStarted", { recipeId });

  // Emit toast with i18n key - client just shows it directly
  emitByPolicy(recipeEmitter, viewPolicy, ctx, "processingToast", {
    recipeId,
    titleKey: "processingAllergies",
    severity: "default",
  });

  const recipe = await getRecipeFull(recipeId);

  if (!recipe) {
    throw new Error(`Recipe not found: ${recipeId}`);
  }

  if (recipe.recipeIngredients.length === 0) {
    log.warn({ recipeId }, "Recipe has no ingredients, skipping allergy detection");
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "allergyDetectionCompleted", { recipeId });
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "processingToast", {
      recipeId,
      titleKey: "allergiesComplete",
      severity: "success",
    });

    return;
  }

  // Get household member IDs to fetch all allergies
  const householdUserIds = await getHouseholdMemberIds(userId);
  const householdAllergies = await getAllergiesForUsers(householdUserIds);

  // Extract unique allergen names
  const allergiesToDetect = Array.from(new Set(householdAllergies.map((a) => a.tagName)));

  if (allergiesToDetect.length === 0) {
    log.info({ recipeId }, "No allergies configured for household, skipping detection");
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "allergyDetectionCompleted", { recipeId });
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "processingToast", {
      recipeId,
      titleKey: "allergiesComplete",
      severity: "success",
    });

    return;
  }

  // Prepare recipe data for AI detection
  const recipeForDetection = {
    title: recipe.name,
    description: recipe.description,
    ingredients: recipe.recipeIngredients.map((ri) => ri.ingredientName),
  };

  const result = await detectAllergiesInRecipe(recipeForDetection, allergiesToDetect);

  if (!result.success) {
    throw new Error(result.error);
  }

  const detectedAllergens = result.data;

  if (detectedAllergens.length === 0) {
    log.info({ recipeId }, "AI detected no allergens");
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "allergyDetectionCompleted", { recipeId });
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "processingToast", {
      recipeId,
      titleKey: "allergiesComplete",
      severity: "success",
    });

    return;
  }

  // Merge detected allergens with existing tags (preserves manually added tags)
  const { newTags, allTags } = await mergeTagsIntoRecipe(recipeId, detectedAllergens);

  log.info(
    { jobId: job.id, recipeId, newTags, totalTags: allTags.length },
    "Allergy detection completed and saved"
  );

  // Fetch updated recipe and emit events
  const updatedRecipe = await getRecipeFull(recipeId);

  if (updatedRecipe) {
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "updated", { recipe: updatedRecipe });
  }

  // Emit completion event so clients can track when allergy detection is done
  emitByPolicy(recipeEmitter, viewPolicy, ctx, "allergyDetectionCompleted", { recipeId });

  // Emit toast with i18n key for completion
  emitByPolicy(recipeEmitter, viewPolicy, ctx, "processingToast", {
    recipeId,
    titleKey: "allergiesComplete",
    severity: "success",
  });
}

async function handleJobFailed(
  job: Job<AllergyDetectionJobData> | undefined,
  error: Error
): Promise<void> {
  if (!job) return;

  const { recipeId } = job.data;
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
    "Allergy detection job failed"
  );

  // Note: We don't emit a "failed" event for allergy detection failures
  // since it's a background enhancement, not a user-initiated action
}

export async function startAllergyDetectionWorker(): Promise<void> {
  await createLazyWorker<AllergyDetectionJobData>(
    QUEUE_NAMES.ALLERGY_DETECTION,
    processAllergyDetectionJob,
    {
      connection: getBullClient(),
      ...baseWorkerOptions,
      stalledInterval: STALLED_INTERVAL[QUEUE_NAMES.ALLERGY_DETECTION],
      concurrency: WORKER_CONCURRENCY[QUEUE_NAMES.ALLERGY_DETECTION],
    },
    handleJobFailed
  );
}

export async function stopAllergyDetectionWorker(): Promise<void> {
  await stopLazyWorker(QUEUE_NAMES.ALLERGY_DETECTION);
}
