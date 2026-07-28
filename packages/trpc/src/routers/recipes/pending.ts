import { z } from "zod";

import type {
  AllergyDetectionJobData,
  AutoCategorizationJobData,
  AutoTaggingJobData,
  NutritionEstimationJobData,
  RecipeImportJobData,
} from "@norish/queue/contracts/job-types";
import type { PendingRecipeDTO } from "@norish/shared/contracts";
import { getQueues } from "@norish/queue/registry";
import { getRecipePermissionPolicy } from "@norish/shared-server/config/server-config-loader";
import { trpcLogger as log } from "@norish/shared-server/logger";

import { authedProcedure } from "../../middleware";
import { router } from "../../trpc";

const getPending = authedProcedure.query(async ({ ctx }) => {
  log.debug({ userId: ctx.user.id }, "Fetching pending recipe imports");

  const policy = await getRecipePermissionPolicy();
  const queues = getQueues();

  const jobs = await queues.recipeImport.getJobs(["waiting", "active", "delayed"]);

  // PENDING-ISO-01 (D-27.1-12): `everyone` folds into the household clamp — it
  // means "fetch WITHIN this cookbook", never "list every cookbook" (the
  // url-disclosing mistake REALTIME/IMPORT-DEDUP/LIST-ISO-01 each made). A
  // no-cookbook viewer has `householdKey === user.id` (middleware), clamping a
  // personal job for free. No admin exemption: household/owner never had one.
  const isOwnerScoped = policy.view === "owner";
  const filteredJobs = jobs.filter((job) =>
    isOwnerScoped ? job.data.userId === ctx.user.id : job.data.householdKey === ctx.householdKey
  );

  const pendingRecipes: PendingRecipeDTO[] = filteredJobs.map((job) => ({
    recipeId: job.data.recipeId,
    url: job.data.url,
    addedAt: job.timestamp,
  }));

  log.debug({ userId: ctx.user.id, count: pendingRecipes.length }, "Found pending recipe imports");

  return pendingRecipes;
});

/**
 * Check if a specific recipe has a pending nutrition estimation job.
 */
const isNutritionEstimating = authedProcedure
  .input(z.object({ recipeId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const queues = getQueues();
    const jobs = await queues.nutritionEstimation.getJobs(["waiting", "active", "delayed"]);

    const isEstimating = jobs.some((job) => {
      return job.data.recipeId === input.recipeId;
    });

    log.debug(
      { userId: ctx.user.id, recipeId: input.recipeId, isEstimating },
      "Checked nutrition estimation status"
    );

    return isEstimating;
  });

/**
 * Get all recipe IDs that have pending auto-tagging jobs.
 * Used to hydrate the auto-tagging state on page load.
 */
const getPendingAutoTagging = authedProcedure.query(async ({ ctx }) => {
  log.debug({ userId: ctx.user.id }, "Fetching pending auto-tagging jobs");

  const queues = getQueues();
  const jobs = await queues.autoTagging.getJobs(["waiting", "active", "delayed"]);

  // Auto-tagging jobs are per-recipe and user-scoped
  const recipeIds = jobs
    .filter(
      (job) =>
        job.data.userId === ctx.user.id || job.data.householdKey === ctx.householdKey
    )
    .map((job) => job.data.recipeId);

  log.debug({ userId: ctx.user.id, count: recipeIds.length }, "Found pending auto-tagging jobs");

  return recipeIds;
});

/**
 * Check if a specific recipe has a pending auto-tagging job.
 */
const isAutoTagging = authedProcedure
  .input(z.object({ recipeId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const queues = getQueues();
    const jobs = await queues.autoTagging.getJobs(["waiting", "active", "delayed"]);

    const isActive = jobs.some(
      (job) => job.data.recipeId === input.recipeId
    );

    log.debug(
      { userId: ctx.user.id, recipeId: input.recipeId, isActive },
      "Checked auto-tagging status"
    );

    return isActive;
  });

const isAutoCategorizing = authedProcedure
  .input(z.object({ recipeId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const queues = getQueues();
    const jobs = await queues.autoCategorization.getJobs(["waiting", "active", "delayed"]);

    const isActive = jobs.some(
      (job) => job.data.recipeId === input.recipeId
    );

    log.debug(
      { userId: ctx.user.id, recipeId: input.recipeId, isActive },
      "Checked auto-categorization status"
    );

    return isActive;
  });

/**
 * Get all recipe IDs that have pending allergy detection jobs.
 * Used to hydrate the allergy detection state on page load.
 */
const getPendingAllergyDetection = authedProcedure.query(async ({ ctx }) => {
  log.debug({ userId: ctx.user.id }, "Fetching pending allergy detection jobs");

  const queues = getQueues();
  const jobs = await queues.allergyDetection.getJobs(["waiting", "active", "delayed"]);

  // Allergy detection jobs are per-recipe and user-scoped
  const recipeIds = jobs
    .filter((job) => {
      return job.data.userId === ctx.user.id || job.data.householdKey === ctx.householdKey;
    })
    .map((job) => job.data.recipeId);

  log.debug(
    { userId: ctx.user.id, count: recipeIds.length },
    "Found pending allergy detection jobs"
  );

  return recipeIds;
});

/**
 * Check if a specific recipe has a pending allergy detection job.
 */
const isAllergyDetecting = authedProcedure
  .input(z.object({ recipeId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const queues = getQueues();
    const jobs = await queues.allergyDetection.getJobs(["waiting", "active", "delayed"]);

    const isActive = jobs.some((job) => {
      return job.data.recipeId === input.recipeId;
    });

    log.debug(
      { userId: ctx.user.id, recipeId: input.recipeId, isActive },
      "Checked allergy detection status"
    );

    return isActive;
  });

export const pendingProcedures = router({
  getPending,
  isNutritionEstimating,
  getPendingAutoTagging,
  isAutoTagging,
  isAutoCategorizing,
  getPendingAllergyDetection,
  isAllergyDetecting,
});
