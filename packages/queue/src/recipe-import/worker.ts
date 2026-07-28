/**
 * Recipe Import Worker
 *
 * Processes recipe import jobs from the queue.
 * Uses lazy worker pattern - starts on-demand and pauses when idle.
 */

import type { Job } from "bullmq";

import type { PermissionLevel } from "@norish/config/zod/server-config";
import type { RecipeImportJobData } from "@norish/queue/contracts/job-types";
import {
  createRecipeWithRefs,
  dashboardRecipe,
  getAllergiesForUsers,
  recipeExistsByUrlForPolicy,
} from "@norish/db";
import { getDecryptedTokensByUserId } from "@norish/db/repositories/site-auth-tokens";
import { addAllergyDetectionJob } from "@norish/queue/allergy-detection/producer";
import { requireQueueApiHandler } from "@norish/queue/api-handlers";
import { addAutoCategorizationJob } from "@norish/queue/auto-categorization/producer";
import { addAutoTaggingJob } from "@norish/queue/auto-tagging/producer";
import { getBullClient } from "@norish/queue/redis/bullmq";
import { getQueues } from "@norish/queue/registry";
import { getAIConfig } from "@norish/shared-server/config/server-config-loader";
import { createLogger } from "@norish/shared-server/logger";
import { deleteRecipeImagesDir } from "@norish/shared-server/media/storage";
import type { PolicyEmitContext } from "@norish/shared-server/realtime/policy";
import { emitByPolicy, resolveHouseholdRealtimeScope } from "@norish/shared-server/realtime/policy";
import { recipeEmitter } from "@norish/shared-server/realtime/recipes";

import {
  baseWorkerOptions,
  QUEUE_NAMES,
  RECIPE_IMPORT_PROCESSING_TIMEOUT_MS,
  STALLED_INTERVAL,
  WORKER_CONCURRENCY,
} from "../config";
import { withTimeout } from "../helpers";
import { createLazyWorker, stopLazyWorker } from "../lazy-worker-manager";
import { emitImportProgress } from "./progress";

const log = createLogger("worker:recipe-import");

/**
 * Process a single recipe import job.
 * Called by the worker for each job.
 */
async function processImportJob(job: Job<RecipeImportJobData>): Promise<void> {
  const parseRecipeFromUrl = requireQueueApiHandler("parseRecipeFromUrl");
  const { url, recipeId, userId, householdKey, householdUserIds, householdId } = job.data;

  log.info(
    { jobId: job.id, url, recipeId, attempt: job.attemptsMade + 1 },
    "Processing recipe import job"
  );

  // REALTIME-ISO-01 (D-22-02): the pending recipe belongs to the cookbook this import
  // targets, so scope on THAT cookbook — not the server-wide default, not the actor's
  // active cookbook. The row does not exist yet, hence the household-based resolver.
  const { viewPolicy, ctx } = await resolveHouseholdRealtimeScope(householdId, {
    userId,
    householdKey,
  });

  // Emit import started event
  emitByPolicy(recipeEmitter, viewPolicy, ctx, "importStarted", { recipeId, url });

  // IMPORT-DEDUP-ISO-01: dedup is per-cookbook and is NOT the realtime view policy.
  // Reusing `viewPolicy` here would send a personal import (householdId null, so the
  // resolver falls back to the server-wide default `everyone`) searching across every
  // cookbook on the server.
  const existingCheck = await recipeExistsByUrlForPolicy(
    url,
    userId,
    householdId,
    householdUserIds,
    "household"
  );

  if (existingCheck.exists && existingCheck.existingRecipeId) {
    const dashboardDto = await dashboardRecipe(existingCheck.existingRecipeId);

    if (dashboardDto) {
      log.info(
        { jobId: job.id, existingRecipeId: existingCheck.existingRecipeId },
        "Recipe already exists, returning existing"
      );

      // Include pendingRecipeId so client can remove the skeleton
      // Show imported toast since no processing will follow for existing recipes
      emitByPolicy(recipeEmitter, viewPolicy, ctx, "imported", {
        recipe: dashboardDto,
        pendingRecipeId: recipeId,
        toast: "imported",
      });
    }

    return;
  }

  // Fetch household allergies for targeted allergy detection (only if autoTagAllergies is enabled)
  const aiConfig = await getAIConfig();
  let allergyNames: string[] | undefined;

  if (aiConfig?.autoTagAllergies) {
    const householdAllergies = await getAllergiesForUsers(householdUserIds ?? [userId]);

    allergyNames = [...new Set(householdAllergies.map((a) => a.tagName))];
    log.debug(
      { allergyCount: allergyNames.length, allergies: allergyNames },
      "Fetched household allergies"
    );
  } else {
    log.debug("Auto-tag allergies disabled, skipping allergy detection");
  }

  // IMPORT-UX-01: honest, cookbook-scoped progress. Reuse the scope resolved above
  // (keyed on the import's target cookbook) — never a fresh server-wide/broadcast scope.
  emitImportProgress({ viewPolicy, ctx }, { recipeId, url, stage: "fetching" });

  // Parse and create recipe
  const userTokens = await getDecryptedTokensByUserId(userId);
  const parseResult = await withTimeout(
    () =>
      parseRecipeFromUrl(
        url,
        recipeId,
        allergyNames,
        job.data.forceAI,
        userTokens.length > 0 ? userTokens : undefined
      ),
    RECIPE_IMPORT_PROCESSING_TIMEOUT_MS,
    "Recipe import parsing"
  );

  log.debug({ parseResult }, "Recipe parse result");
  if (!parseResult.recipe) {
    throw new Error("Failed to parse recipe from URL");
  }

  emitImportProgress({ viewPolicy, ctx }, { recipeId, url, stage: "saving" });

  // W3: `parseResult.cook` is non-null only when the AI extraction earned a `.cook`
  // (D-27-W3-04). `undefined` keeps the legacy projection write, exactly as before.
  const createdId = await createRecipeWithRefs(
    recipeId,
    userId,
    householdId,
    parseResult.recipe,
    parseResult.cook ?? undefined
  );

  if (!createdId) {
    throw new Error("Failed to save imported recipe");
  }

  const dashboardDto = await dashboardRecipe(createdId);

  if (dashboardDto) {
    log.info(
      { jobId: job.id, recipeId: createdId, url, usedAI: parseResult.usedAI },
      "Recipe imported successfully"
    );

    // If AI was used, no processing will follow - show imported toast
    // If AI was NOT used, auto-tagging/allergy detection will follow - no toast needed
    emitByPolicy(recipeEmitter, viewPolicy, ctx, "imported", {
      recipe: dashboardDto,
      pendingRecipeId: recipeId,
      toast: parseResult.usedAI ? "imported" : undefined,
    });

    // Trigger auto-tagging only if AI was NOT used for extraction
    // (AI extraction already includes auto-tagging instructions in the prompt)
    if (!parseResult.usedAI) {
      const queues = getQueues();

      await addAutoTaggingJob(queues.autoTagging, {
        recipeId: createdId,
        userId,
        householdKey,
      });

      // Trigger allergy detection for structured imports
      // (AI extraction already handles allergy detection inline)
      await addAllergyDetectionJob(queues.allergyDetection, {
        recipeId: createdId,
        userId,
        householdKey,
      });

      // Trigger auto-categorization for structured imports without categories
      // (AI extraction already includes categorization in the prompt)
      if (!parseResult.recipe.categories?.length) {
        await addAutoCategorizationJob(queues.autoCategorization, {
          recipeId: createdId,
          userId,
          householdKey,
        });
      }
    }
  }
}

/**
 * Handle job failure.
 * Emits failed event if this was the final attempt.
 *
 * D-27.1-07 / T-27.1-03-03: this function can NEVER reject. `lazy-worker-manager.ts:259-263`
 * only LOGS a rejection from `onFailed`, so an unguarded throw anywhere below was exactly how
 * the `failed` event used to disappear silently, leaving an eternal skeleton card. Every
 * risky step below has its own guard, mirroring the `backfillCookSource` never-throw pattern
 * (`packages/api/src/startup/backfill-cook-source.ts`), and the whole body is wrapped besides.
 *
 * Test-only export: driven directly by `failed-emit-isolation.test.ts` so the isolation suite
 * exercises the real handler rather than a duplicated copy of its logic.
 */
export async function handleJobFailed(
  job: Job<RecipeImportJobData> | undefined,
  error: Error
): Promise<void> {
  if (!job) return;

  try {
    const { url, recipeId, userId, householdKey, householdId } = job.data;
    const maxAttempts = job.opts.attempts ?? 3;
    const isFinalFailure = job.attemptsMade >= maxAttempts;

    log.error(
      {
        jobId: job.id,
        url,
        recipeId,
        attempt: job.attemptsMade,
        maxAttempts,
        isFinalFailure,
        error: error.message,
      },
      "Recipe import job failed"
    );

    if (isFinalFailure) {
      // EMIT FIRST, CLEAN UP AFTER. The ORDER is the mitigation, not the try/catch below —
      // resolving the failed emit before any cleanup means a throw in cleanup can never
      // stand between a final failure and the only signal the client ever gets.
      let viewPolicy: PermissionLevel;
      let ctx: PolicyEmitContext;

      try {
        ({ viewPolicy, ctx } = await resolveHouseholdRealtimeScope(householdId, {
          userId,
          householdKey,
        }));
      } catch (scopeErr) {
        // T-27.1-03-02: a failure to RESOLVE a policy must never WIDEN one. Fall back to
        // the narrowest scope — `owner` against the job's own actor context — which still
        // reaches only the importer, never a wider audience.
        log.error(
          { err: scopeErr, jobId: job.id, recipeId },
          "Realtime scope resolution failed on job failure; failing closed to the importer"
        );
        viewPolicy = "owner";
        ctx = { userId, householdKey };
      }

      // SCOPE SYMMETRY IS DELIBERATE. `importStarted` created this skeleton at household
      // scope, so the event that removes it must reach the SAME audience — narrowing a
      // healthy resolution to `owner` here would leave every other member of a shared
      // cookbook holding a skeleton nothing ever clears, the exact defect this plan closes.
      // (`emitByPolicy` still clamps `everyone` to the cookbook boundary; D-22-01.)
      try {
        emitByPolicy(recipeEmitter, viewPolicy, ctx, "failed", {
          reason: error.message || "Failed to import recipe after multiple attempts",
          recipeId,
          url,
        });
      } catch (emitErr) {
        log.error({ err: emitErr, jobId: job.id, recipeId }, "Failed to emit `failed` event");
      }
    }

    // Cleanup runs on every failure, final or not — exactly as before. Only its position
    // moved, to AFTER the emit, so a throw here can never swallow the failure signal.
    try {
      await deleteRecipeImagesDir(recipeId);
    } catch (cleanupErr) {
      log.error(
        { err: cleanupErr, jobId: job.id, recipeId },
        "Failed to delete recipe images directory on job failure"
      );
    }
  } catch (err) {
    log.error({ err, jobId: job?.id }, "handleJobFailed threw unexpectedly");
  }
}

/**
 * Start the recipe import worker (lazy - starts on demand).
 * Call during server startup.
 */
export async function startRecipeImportWorker(): Promise<void> {
  const rawProcessor = (job: Job<RecipeImportJobData>) =>
    withTimeout(
      () => processImportJob(job),
      RECIPE_IMPORT_PROCESSING_TIMEOUT_MS,
      "Recipe import job"
    );

  await createLazyWorker<RecipeImportJobData>(
    QUEUE_NAMES.RECIPE_IMPORT,
    rawProcessor,
    {
      connection: getBullClient(),
      ...baseWorkerOptions,
      stalledInterval: STALLED_INTERVAL[QUEUE_NAMES.RECIPE_IMPORT],
      concurrency: WORKER_CONCURRENCY[QUEUE_NAMES.RECIPE_IMPORT],
    },
    handleJobFailed
  );
}

export async function stopRecipeImportWorker(): Promise<void> {
  await stopLazyWorker(QUEUE_NAMES.RECIPE_IMPORT);
}
