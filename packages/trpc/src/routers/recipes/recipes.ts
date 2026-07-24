import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { RecipeListContext } from "@norish/db";
import {
  canAccessResource,
  isAIEnabled as checkAIEnabled,
  resolveRecipeCookbookPolicy,
} from "@norish/auth/permissions";
import {
  addStepsAndIngredientsToRecipeByInput,
  createRecipeWithRefs,
  dashboardRecipe,
  deleteRecipeById,
  FullRecipeInsertSchema,
  getDinnerSuggestionCandidates,
  getRandomRecipeCandidates,
  getRecipeFull,
  listRecipes,
  MOVE_DESTINATION_URL_CONFLICT,
  moveRecipeToHousehold,
  RecipeConvertInputSchema,
  RecipeDeleteInputSchema,
  RecipeMoveInputSchema,
  RecipeGetInputSchema,
  RecipeImportInputSchema,
  RecipeListInputSchema,
  RecipeUpdateInputSchema,
  searchRecipesByName,
  setActiveSystemForRecipe,
  updateRecipeCategories,
  updateRecipeWithRefs,
} from "@norish/db";
import {
  addAllergyDetectionJob,
  addAutoCategorizationJob,
  addAutoTaggingJob,
  addImageImportJob,
  addImportJob,
  addNutritionEstimationJob,
  addPasteImportJob,
  preparePasteImport,
} from "@norish/queue";
import { getQueues } from "@norish/queue/registry";
import { withCookTokens } from "@norish/shared-server/cooklang/attach-tokens";
import { trpcLogger as log } from "@norish/shared-server/logger";
import { deleteRecipeImagesDir } from "@norish/shared-server/media/storage";
import { selectDinnerSuggestions } from "@norish/shared-server/recipes/dinner-suggester";
import { selectWeightedRandomRecipe } from "@norish/shared-server/recipes/randomizer";
import { FilterMode, RecipeCategory, SortOrder } from "@norish/shared/contracts";
import { FullRecipeSchema, RecipeListResultSchema } from "@norish/shared/contracts/zod";

import { formDataInputSchema, isUploadedFile } from "../../form-data";
import { emitByPolicy, resolveRecipeRealtimeScope } from "../../helpers";
import { authedProcedure } from "../../middleware";
import { router } from "../../trpc";
import { recipeEmitter } from "./emitter";
import {
  assertRecipeAccess,
  assertRecipeMoveAllowed,
  findRecipeForViewer,
  handleRecipeError,
  hasTargetSystemProjection,
} from "./helpers";
import {
  randomRecipeInputSchema,
  dinnerSuggestionInputSchema,
  recipeAutocompleteInputSchema,
  recipeIdInputSchema,
  recipeImportBulkInputSchema,
  recipeImportBulkOutputSchema,
  recipeImportPasteInputSchema,
  recipeImportPasteOutputSchema,
} from "./recipes-openapi-types";

// Procedures
export const listProcedure = authedProcedure
  .meta({
    openapi: {
      method: "POST",
      path: "/recipes/search",
      protect: true,
      tags: ["Recipes"],
      summary: "List recipes",
      description:
        "Returns a paginated list of recipes. All filter fields are optional, so you can omit them to fetch the default recipe list.",
      errorResponses: {
        401: "Missing or invalid API credentials",
      },
    },
  })
  .input(RecipeListInputSchema)
  .output(RecipeListResultSchema)
  .query(async ({ ctx, input }) => {
    const {
      cursor,
      limit,
      search,
      searchFields,
      tags,
      filterMode,
      sortMode,
      minRating,
      maxCookingTime,
      categories,
    } = input;

    log.debug({ userId: ctx.user.id, cursor, limit }, "Listing recipes");

    const listCtx: RecipeListContext = {
      userId: ctx.user.id,
      householdUserIds: ctx.householdUserIds,
      activeHouseholdId: ctx.household?.id ?? null,
      memberHouseholdIds: ctx.memberHouseholdIds,
      isServerAdmin: ctx.isServerAdmin,
    };

    const result = await listRecipes(
      listCtx,
      limit,
      cursor,
      search,
      searchFields,
      tags,
      filterMode as FilterMode,
      sortMode as SortOrder,
      minRating,
      maxCookingTime,
      categories
    );

    log.debug({ count: result.recipes.length, total: result.total }, "Listed recipes");

    return {
      recipes: result.recipes,
      total: result.total,
      nextCursor: cursor + limit < result.total ? cursor + limit : null,
    };
  });

export const getProcedure = authedProcedure
  .meta({
    openapi: {
      method: "GET",
      path: "/recipes/{id}",
      protect: true,
      tags: ["Recipes"],
      summary: "Get a recipe by ID",
      errorResponses: {
        401: "Missing or invalid API credentials",
        404: "Recipe not found",
      },
    },
  })
  .input(RecipeGetInputSchema)
  .output(FullRecipeSchema)
  .query(async ({ ctx, input }) => {
    log.debug({ userId: ctx.user.id, recipeId: input.id }, "Getting recipe");

    const recipe = await findRecipeForViewer(ctx, input.id);

    if (!recipe) {
      log.warn({ userId: ctx.user.id, recipeId: input.id }, "Recipe not found or not accessible");

      throw new TRPCError({ code: "NOT_FOUND", message: "Recipe not found" });
    }

    return recipe;
  });

export const getEditableProcedure = authedProcedure
  .input(RecipeGetInputSchema)
  .output(FullRecipeSchema)
  .query(async ({ ctx, input }) => {
    log.debug({ userId: ctx.user.id, recipeId: input.id }, "Getting editable recipe");

    const recipe = await getRecipeFull(input.id);

    if (!recipe) {
      log.warn({ userId: ctx.user.id, recipeId: input.id }, "Editable recipe not found");

      throw new TRPCError({ code: "NOT_FOUND", message: "Recipe not found" });
    }

    await assertRecipeAccess(ctx, input.id, "edit");

    // HOUSE-06: strictly AFTER the edit gate above — see `withCookTokens`.
    return withCookTokens(recipe);
  });

export const createRecipeProcedure = authedProcedure
  .meta({
    openapi: {
      method: "POST",
      path: "/recipes",
      protect: true,
      tags: ["Recipes"],
      summary: "Create a recipe",
      description:
        "Creates a recipe directly from structured recipe data without parser transformation.",
      errorResponses: {
        401: "Missing or invalid API credentials",
      },
    },
  })
  .input(FullRecipeInsertSchema)
  .output(z.uuid())
  .mutation(({ ctx, input }) => {
    const recipeId = input.id ?? randomUUID();

    log.info(
      { userId: ctx.user.id, recipeName: input.name, recipeId, providedId: input.id },
      "Creating recipe"
    );
    log.debug({ recipe: input }, "Full recipe data");

    if (input.id && input.id !== recipeId) {
      log.error({ inputId: input.id, generatedId: recipeId }, "Recipe ID mismatch detected!");
    }

    createRecipeWithRefs(recipeId, ctx.user.id, ctx.household?.id ?? null, input)
      .then(async (createdId) => {
        if (!createdId) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create recipe",
          });
        }

        const dashboardDto = await dashboardRecipe(createdId);

        if (dashboardDto) {
          log.info({ userId: ctx.user.id, recipeId: createdId }, "Recipe created");
          const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(createdId, {
            userId: ctx.user.id,
            householdKey: ctx.householdKey,
          });

          emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "created", { recipe: dashboardDto });
        }
      })
      .catch((err) => handleRecipeError(ctx, err, "create recipe", { recipeId }));

    return recipeId;
  });

const update = authedProcedure.input(RecipeUpdateInputSchema).mutation(({ ctx, input }) => {
  const { id, data, version } = input;

  log.info({ userId: ctx.user.id, recipeId: id }, "Updating recipe");
  log.debug({ recipe: input }, "Full recipe data");

  assertRecipeAccess(ctx, id, "edit")
    .then(async () => {
      const result = await updateRecipeWithRefs(id, ctx.user.id, data, version);

      if (result.stale) {
        log.info({ userId: ctx.user.id, recipeId: id, version }, "Ignoring stale recipe update");

        return;
      }

      const updatedRecipe = await getRecipeFull(id);

      if (updatedRecipe) {
        log.info({ userId: ctx.user.id, recipeId: id }, "Recipe updated");
        const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(id, {
          userId: ctx.user.id,
          householdKey: ctx.householdKey,
        });

        emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "updated", { recipe: updatedRecipe });
      }
    })
    .catch((err) => handleRecipeError(ctx, err, "update recipe", { recipeId: id }));

  return { success: true };
});

const updateCategories = authedProcedure
  .input(
    z.object({
      recipeId: z.string().uuid(),
      version: z.number().int().positive(),
      categories: z.array(z.enum(["Breakfast", "Lunch", "Dinner", "Snack"])),
    })
  )
  .mutation(async ({ ctx, input }) => {
    await assertRecipeAccess(ctx, input.recipeId, "edit");

    const result = await updateRecipeCategories(
      input.recipeId,
      input.categories as RecipeCategory[],
      input.version
    );

    if (result.stale) {
      log.info(
        { userId: ctx.user.id, recipeId: input.recipeId, version: input.version },
        "Ignoring stale recipe category update"
      );

      return { success: true, stale: true };
    }

    const updated = await getRecipeFull(input.recipeId);

    if (updated) {
      const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(input.recipeId, {
        userId: ctx.user.id,
        householdKey: ctx.householdKey,
      });

      emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "updated", { recipe: updated });
    }

    return { success: true };
  });

const deleteProcedure = authedProcedure
  .input(RecipeDeleteInputSchema)
  .mutation(({ ctx, input }) => {
    const { id, version } = input;

    log.info({ userId: ctx.user.id, recipeId: id }, "Deleting recipe");

    assertRecipeAccess(ctx, id, "delete")
      .then(async () => {
        // Resolve the emit scope BEFORE the row disappears — afterwards
        // resolveRecipeRealtimeScope can only fail closed to the actor, and the recipe's
        // own cookbook would never learn of the deletion.
        const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(id, {
          userId: ctx.user.id,
          householdKey: ctx.householdKey,
        });

        await deleteRecipeImagesDir(id);
        const result = await deleteRecipeById(id, version);

        if (result.stale) {
          log.info({ userId: ctx.user.id, recipeId: id, version }, "Ignoring stale recipe delete");

          return;
        }

        log.info({ userId: ctx.user.id, recipeId: id }, "Recipe deleted");
        emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "deleted", { id });
      })
      .catch((err) => handleRecipeError(ctx, err, "delete recipe", { recipeId: id }));

    return { success: true };
  });

const move = authedProcedure.input(RecipeMoveInputSchema).mutation(async ({ ctx, input }) => {
  const { id, destinationHouseholdId, version } = input;

  log.info(
    { userId: ctx.user.id, recipeId: id, destinationHouseholdId },
    "Moving recipe to cookbook"
  );

  // SECURITY (CKBK-MOVE-01 / HOUSE-06 / POLICY-01): edit rights on the SOURCE
  // cookbook AND membership of / ownership for the DESTINATION.
  await assertRecipeMoveAllowed(ctx, id, destinationHouseholdId);

  // Resolve the SOURCE realtime scope BEFORE the move — while the recipe still
  // lives in its old cookbook — so the "removed" signal keys on the cookbook it
  // is leaving (AGENTS.md realtime rule / Phase 22 D-22-02).
  const sourceScope = await resolveRecipeRealtimeScope(id, {
    userId: ctx.user.id,
    householdKey: ctx.householdKey,
  });

  let result;

  try {
    result = await moveRecipeToHousehold(id, destinationHouseholdId, version);
  } catch (err) {
    if (err instanceof Error && err.message === MOVE_DESTINATION_URL_CONFLICT) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A recipe with this URL already exists in the destination cookbook",
      });
    }

    throw err;
  }

  if (result.stale) {
    log.info({ userId: ctx.user.id, recipeId: id, version }, "Ignoring stale recipe move");

    return { success: true, stale: true };
  }

  // Tell the SOURCE cookbook to drop the now-stale card. Id-only: no recipe DTO
  // is pushed to the cookbook it left (Success Criterion 4).
  emitByPolicy(recipeEmitter, sourceScope.viewPolicy, sourceScope.ctx, "deleted", { id });

  // Tell the DESTINATION cookbook it gained the recipe — resolve the scope AGAIN,
  // now that the row lives in the destination, so it keys on the recipe's own
  // (new) cookbook and never broadcasts.
  const destScope = await resolveRecipeRealtimeScope(id, {
    userId: ctx.user.id,
    householdKey: ctx.householdKey,
  });
  const dashboardDto = await dashboardRecipe(id);

  if (dashboardDto) {
    emitByPolicy(recipeEmitter, destScope.viewPolicy, destScope.ctx, "created", {
      recipe: dashboardDto,
    });
  }

  return { success: true };
});

export const importFromUrlProcedure = authedProcedure
  .meta({
    openapi: {
      method: "POST",
      path: "/recipes/import/url",
      protect: true,
      tags: ["Recipe Imports"],
      summary: "Queue a recipe import from a URL",
      errorResponses: {
        401: "Missing or invalid API credentials",
        409: "This recipe already exists or is being imported",
      },
    },
  })
  .input(RecipeImportInputSchema.extend({ forceAI: z.boolean().optional() }))
  .output(z.uuid())
  .mutation(async ({ ctx, input }) => {
    const { url, forceAI } = input;
    const recipeId = randomUUID();

    // Add job to queue - returns conflict status if duplicate in queue
    const queues = getQueues();
    const result = await addImportJob(queues.recipeImport, {
      url,
      recipeId,
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
      householdUserIds: ctx.householdUserIds,
      householdId: ctx.household?.id ?? null,
      forceAI,
    });

    if (result.status === "exists" || result.status === "duplicate") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This recipe already exists or is being imported",
      });
    }

    return recipeId;
  });

export const importFromUrlsProcedure = authedProcedure
  .meta({
    openapi: {
      method: "POST",
      path: "/recipes/import/urls",
      protect: true,
      tags: ["Recipe Imports"],
      summary: "Queue a bulk recipe import from many URLs",
      errorResponses: {
        401: "Missing or invalid API credentials",
      },
    },
  })
  .input(recipeImportBulkInputSchema)
  .output(recipeImportBulkOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const { urls, forceAI } = input;
    const queues = getQueues();

    log.info(
      { userId: ctx.user.id, count: urls.length, householdId: ctx.household?.id ?? null },
      "Processing bulk recipe import request"
    );

    // BULK-01: fan out over the EXISTING single-import job path — one job per URL, each
    // carrying the active cookbook (householdId). addImportJob does the SAME per-cookbook
    // dedup + job-id scoping the single path uses (Phase 22.1), so two cookbooks importing
    // the same URL never collide and dedup stays within the ACTOR's cookbook only. Partial
    // failure is normal: we report each URL's enqueue outcome instead of one aggregate error.
    const items = await Promise.all(
      urls.map(async (url) => {
        const recipeId = randomUUID();
        const result = await addImportJob(queues.recipeImport, {
          url,
          recipeId,
          userId: ctx.user.id,
          householdKey: ctx.householdKey,
          householdUserIds: ctx.householdUserIds,
          householdId: ctx.household?.id ?? null,
          forceAI,
        });

        if (result.status === "exists") {
          return { url, recipeId, status: "exists" as const, existingRecipeId: result.existingRecipeId };
        }

        if (result.status === "duplicate") {
          return { url, recipeId, status: "duplicate" as const };
        }

        return { url, recipeId, status: "queued" as const };
      })
    );

    return { items };
  });

const reserveId = authedProcedure.query(() => {
  const recipeId = randomUUID();

  log.debug({ recipeId }, "Reserved recipe ID for step image uploads");

  return { recipeId };
});

const convertMeasurements = authedProcedure
  .input(RecipeConvertInputSchema)
  .mutation(({ ctx, input }) => {
    const { recipeId, targetSystem, version } = input;

    log.info({ userId: ctx.user.id, recipeId, targetSystem }, "Converting recipe measurements");

    checkAIEnabled()
      .then((aiEnabled) => {
        if (!aiEnabled) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "AI features are disabled",
          });
        }

        return getRecipeFull(recipeId);
      })
      .then(async (recipe) => {
        if (!recipe) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Recipe not found",
          });
        }

        if (recipe.recipeIngredients.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Recipe has no ingredients to convert",
          });
        }

        // Check edit permission (uses recipe.userId directly since we have the full recipe)
        if (recipe.userId) {
          const { policy, adminUserId } = await resolveRecipeCookbookPolicy(recipe.householdId);
          const canEdit = canAccessResource(
            "edit",
            ctx.user.id,
            recipe.userId,
            recipe.householdId,
            ctx.memberHouseholdIds,
            ctx.isServerAdmin,
            policy,
            adminUserId
          );

          if (!canEdit) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "You do not have permission to edit this recipe",
            });
          }
        }

        return recipe;
      })
      .then((recipe) => {
        // Check if already converted — INGREDIENTS *AND* STEPS (D-27-W2-06).
        // See `hasTargetSystemProjection` for why ingredients alone is not enough
        // once `deriveProjectionTx` starts writing both systems' ingredient rows.
        if (hasTargetSystemProjection(recipe, targetSystem)) {
          return setActiveSystemForRecipe(recipe.id, targetSystem, version).then(async (result) => {
            if (result.stale) {
              log.info(
                { userId: ctx.user.id, recipeId, version },
                "Ignoring stale recipe conversion"
              );

              return null;
            }

            const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(recipe.id, {
              userId: ctx.user.id,
              householdKey: ctx.householdKey,
            });

            emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "converted", {
              recipe: { ...recipe, systemUsed: targetSystem },
            });

            return null; // Signal to stop chain
          });
        }

        return recipe;
      })
      .then((recipe) => {
        if (recipe === null) return null;

        // Convert with AI
        return import("@norish/shared-server/ai/unit-converter")
          .then(({ convertRecipeDataWithAI }) => convertRecipeDataWithAI(recipe, targetSystem))
          .then((result) => {
            if (!result.success) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: result.error ?? "Conversion failed, please try again.",
              });
            }

            return { recipe, converted: result.data };
          });
      })
      .then((result) => {
        if (result === null) return;

        const { recipe, converted } = result;

        const steps = converted.steps.map((s) => ({
          ...s,
          recipeId: recipe.id,
          systemUsed: targetSystem,
        }));

        const ingredients = converted.ingredients.map((i) => ({
          ...i,
          recipeId: recipe.id,
          systemUsed: targetSystem,
        }));

        return addStepsAndIngredientsToRecipeByInput(steps, ingredients)
          .then(() => setActiveSystemForRecipe(recipe.id, targetSystem, version))
          .then(() => getRecipeFull(recipe.id))
          .then(async (updatedRecipe) => {
            if (updatedRecipe) {
              log.info({ userId: ctx.user.id, recipeId }, "Recipe measurements converted");
              const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(recipeId, {
                userId: ctx.user.id,
                householdKey: ctx.householdKey,
              });

              emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "converted", {
                recipe: { ...updatedRecipe, systemUsed: targetSystem },
              });
            }
          });
      })
      .catch((err) => handleRecipeError(ctx, err, "convert recipe measurements", { recipeId }));

    return { success: true };
  });

const autocomplete = authedProcedure
  .input(recipeAutocompleteInputSchema)
  .query(async ({ ctx, input }) => {
    log.debug({ userId: ctx.user.id, query: input.query }, "Searching recipes for autocomplete");

    const listCtx: RecipeListContext = {
      userId: ctx.user.id,
      householdUserIds: ctx.householdUserIds,
      activeHouseholdId: ctx.household?.id ?? null,
      memberHouseholdIds: ctx.memberHouseholdIds,
      isServerAdmin: ctx.isServerAdmin,
    };

    const results = await searchRecipesByName(listCtx, input.query, 10);

    return results;
  });

const getRandomRecipe = authedProcedure
  .input(randomRecipeInputSchema)
  .query(async ({ ctx, input }) => {
    const listCtx: RecipeListContext = {
      userId: ctx.user.id,
      householdUserIds: ctx.householdUserIds,
      activeHouseholdId: ctx.household?.id ?? null,
      memberHouseholdIds: ctx.memberHouseholdIds,
      isServerAdmin: ctx.isServerAdmin,
    };

    let candidates = await getRandomRecipeCandidates(listCtx, input.category);

    if (candidates.length <= 1 && input.category) {
      candidates = await getRandomRecipeCandidates(listCtx, undefined);
    }

    const selected = selectWeightedRandomRecipe(candidates);

    if (!selected) {
      return null;
    }

    return { id: selected.id, name: selected.name, image: selected.image };
  });

// DINNER-01: "what's for dinner" suggestion. The candidate set comes from
// getDinnerSuggestionCandidates, which reuses buildViewPolicyCondition wholesale
// — so the per-cookbook boundary is INHERITED (a viewer never gets another
// cookbook's recipe as a candidate, including under live `view: "everyone"`).
// The ranking (season from the recipe's own tags + recent household ratings) is
// a pure, deterministic function of (candidates, now). The rater avatars/stars/
// thought-bubble the UI shows come from the ALREADY-gated ratings.getRaters
// procedure (RATE-01) — this procedure never fetches rater names itself.
const dinnerSuggestion = authedProcedure
  .input(dinnerSuggestionInputSchema)
  .query(async ({ ctx, input }) => {
    const listCtx: RecipeListContext = {
      userId: ctx.user.id,
      householdUserIds: ctx.householdUserIds,
      activeHouseholdId: ctx.household?.id ?? null,
      memberHouseholdIds: ctx.memberHouseholdIds,
      isServerAdmin: ctx.isServerAdmin,
    };

    const candidates = await getDinnerSuggestionCandidates(listCtx);

    const suggestions = selectDinnerSuggestions(candidates, {
      now: new Date(),
      count: input.count,
    });

    log.debug(
      { userId: ctx.user.id, candidateCount: candidates.length, returned: suggestions.length },
      "Dinner suggestion"
    );

    return { suggestions };
  });

const importFromImagesProcedure = authedProcedure
  .input(formDataInputSchema)
  .mutation(async ({ ctx, input }) => {
    const files: Array<{ data: string; mimeType: string; filename: string }> = [];

    // Process files from FormData
    const filePromises: Promise<void>[] = [];

    input.forEach((value, key) => {
      if (!key.startsWith("file") || !isUploadedFile(value)) {
        return;
      }

      filePromises.push(
        value.arrayBuffer().then((arrayBuffer) => {
          const buffer = Buffer.from(arrayBuffer);

          files.push({
            data: buffer.toString("base64"),
            mimeType: value.type,
            filename: value.name,
          });
        })
      );
    });

    await Promise.all(filePromises);

    if (files.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No files provided",
      });
    }

    const recipeId = randomUUID();

    log.info(
      { userId: ctx.user.id, fileCount: files.length, recipeId },
      "Processing image import request"
    );

    const queues = getQueues();
    const result = await addImageImportJob(queues.imageImport, {
      recipeId,
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
      householdUserIds: ctx.householdUserIds,
      householdId: ctx.household?.id ?? null,
      files,
    });

    if (result.status === "duplicate") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This import is already in progress",
      });
    }

    return recipeId;
  });

export const importFromPasteProcedure = authedProcedure
  .meta({
    openapi: {
      method: "POST",
      path: "/recipes/import/paste",
      protect: true,
      tags: ["Recipe Imports"],
      summary: "Queue a recipe import from pasted text",
      errorResponses: {
        401: "Missing or invalid API credentials",
        409: "This import is already in progress",
      },
    },
  })
  .input(recipeImportPasteInputSchema)
  .output(recipeImportPasteOutputSchema)
  .mutation(async ({ ctx, input }) => {
    const preparedImport = await preparePasteImport(input.text, input.forceAI);

    log.info(
      { userId: ctx.user.id, recipeIds: preparedImport.recipeIds, textLength: input.text.length },
      "Processing paste import request"
    );

    const queues = getQueues();
    const result = await addPasteImportJob(queues.pasteImport, {
      ...preparedImport,
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
      householdUserIds: ctx.householdUserIds,
      householdId: ctx.household?.id ?? null,
    });

    if (result.status === "duplicate") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "This import is already in progress",
      });
    }

    return { recipeIds: preparedImport.recipeIds };
  });

const estimateNutrition = authedProcedure
  .input(recipeIdInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { recipeId } = input;

    log.info({ userId: ctx.user.id, recipeId }, "Queueing nutrition estimation for recipe");

    const aiEnabled = await checkAIEnabled();

    if (!aiEnabled) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "AI features are disabled",
      });
    }

    const recipe = await getRecipeFull(recipeId);

    if (!recipe) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Recipe not found",
      });
    }

    if (recipe.recipeIngredients.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Recipe has no ingredients to estimate from",
      });
    }

    // Add to queue for background processing
    const queues = getQueues();
    const result = await addNutritionEstimationJob(queues.nutritionEstimation, {
      recipeId,
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
      householdUserIds: ctx.householdUserIds,
    });

    if (result.status === "duplicate") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Nutrition estimation is already in progress for this recipe",
      });
    }

    const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(recipeId, {
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
    });

    emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "nutritionStarted", { recipeId });

    return { success: true };
  });

const triggerAutoTag = authedProcedure
  .input(recipeIdInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { recipeId } = input;

    log.info({ userId: ctx.user.id, recipeId }, "Queueing auto-tagging for recipe");

    const aiEnabled = await checkAIEnabled();

    if (!aiEnabled) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "AI features are disabled",
      });
    }

    const recipe = await getRecipeFull(recipeId);

    if (!recipe) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Recipe not found",
      });
    }

    if (recipe.recipeIngredients.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Recipe has no ingredients to generate tags from",
      });
    }

    // Add to queue for background processing
    const queues = getQueues();
    const result = await addAutoTaggingJob(queues.autoTagging, {
      recipeId,
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
    });

    if (result.status === "duplicate") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Auto-tagging is already in progress for this recipe",
      });
    }

    if (result.status === "skipped") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Auto-tagging is disabled",
      });
    }

    const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(recipeId, {
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
    });

    emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "autoTaggingStarted", { recipeId });

    return { success: true };
  });

const triggerAutoCategorize = authedProcedure
  .input(recipeIdInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { recipeId } = input;

    log.info({ userId: ctx.user.id, recipeId }, "Queueing auto-categorization for recipe");

    const aiEnabled = await checkAIEnabled();

    if (!aiEnabled) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "AI features are disabled",
      });
    }

    const recipe = await getRecipeFull(recipeId);

    if (!recipe) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Recipe not found",
      });
    }

    if (recipe.recipeIngredients.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Recipe has no ingredients to generate categories from",
      });
    }

    const queues = getQueues();
    const result = await addAutoCategorizationJob(queues.autoCategorization, {
      recipeId,
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
    });

    if (result.status === "duplicate") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Auto-categorization is already in progress for this recipe",
      });
    }

    if (result.status === "skipped") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Auto-categorization is disabled",
      });
    }

    return { success: true };
  });

const triggerAllergyDetection = authedProcedure
  .input(recipeIdInputSchema)
  .mutation(async ({ ctx, input }) => {
    const { recipeId } = input;

    log.info({ userId: ctx.user.id, recipeId }, "Queueing allergy detection for recipe");

    const aiEnabled = await checkAIEnabled();

    if (!aiEnabled) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "AI features are disabled",
      });
    }

    const recipe = await getRecipeFull(recipeId);

    if (!recipe) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Recipe not found",
      });
    }

    if (recipe.recipeIngredients.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Recipe has no ingredients to detect allergies from",
      });
    }

    // Add to queue for background processing
    const queues = getQueues();
    const result = await addAllergyDetectionJob(queues.allergyDetection, {
      recipeId,
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
    });

    if (result.status === "duplicate") {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Allergy detection is already in progress for this recipe",
      });
    }

    if (result.status === "skipped") {
      const reasonMessage =
        result.reason === "no_allergies"
          ? "No allergies configured for your household"
          : "Allergy detection is disabled";

      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: reasonMessage,
      });
    }

    const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(recipeId, {
      userId: ctx.user.id,
      householdKey: ctx.householdKey,
    });

    emitByPolicy(recipeEmitter, viewPolicy, emitCtx, "allergyDetectionStarted", { recipeId });

    return { success: true };
  });

export const recipesProcedures = router({
  list: listProcedure,
  get: getProcedure,
  getEditable: getEditableProcedure,
  create: createRecipeProcedure,
  update,
  delete: deleteProcedure,
  move,
  importFromUrl: importFromUrlProcedure,
  importFromUrls: importFromUrlsProcedure,
  importFromImages: importFromImagesProcedure,
  importFromPaste: importFromPasteProcedure,
  convertMeasurements,
  estimateNutrition,
  triggerAutoTag,
  triggerAutoCategorize,
  triggerAllergyDetection,
  reserveId,
  autocomplete,
  updateCategories,
  getRandomRecipe,
  dinnerSuggestion,
});
