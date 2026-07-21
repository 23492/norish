import {
  getAverageRating,
  getRecipeRaters,
  getUserRatingWithVersion,
  rateRecipe,
  removeUserRating,
} from "@norish/db/repositories/ratings";
import { trpcLogger as log } from "@norish/shared-server/logger";
import {
  RatingGetInputSchema,
  RatingInputSchema,
  RatingRemoveInputSchema,
} from "@norish/shared/contracts/zod";

import { emitByPolicy, resolveRecipeRealtimeScope } from "../../helpers";
import { authedProcedure } from "../../middleware";
import { router } from "../../trpc";
import { assertRecipeAccess } from "../recipes/helpers";
import { ratingsEmitter } from "./emitter";

interface UserContext {
  user: { id: string };
  householdKey: string;
}

function emitRatingFailed(ctx: UserContext, recipeId: string, reason: string): void {
  // REALTIME-ISO-01: a failed rating attempt concerns only the user who attempted it —
  // `owner` scope sends it to that user's channel and nowhere else.
  emitByPolicy(
    ratingsEmitter,
    "owner",
    { userId: ctx.user.id, householdKey: ctx.householdKey },
    "ratingFailed",
    {
      recipeId,
      reason,
    }
  );
}

const rate = authedProcedure.input(RatingInputSchema).mutation(({ ctx, input }) => {
  const { recipeId, rating, version } = input;

  log.debug({ userId: ctx.user.id, recipeId, rating }, "Rating recipe");

  rateRecipe(ctx.user.id, recipeId, rating, version)
    .then(async (result) => {
      if (result.stale) {
        log.info({ userId: ctx.user.id, recipeId, version }, "Ignoring stale rating mutation");

        return;
      }

      const stats = await getAverageRating(recipeId);
      // REALTIME-ISO-01 (D-22-02): the rating belongs to the RECIPE's cookbook, which is
      // not necessarily the rater's active one (a recipe shared into another cookbook).
      const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(recipeId, {
        userId: ctx.user.id,
        householdKey: ctx.householdKey,
      });

      log.info({ userId: ctx.user.id, recipeId, rating, isNew: result.isNew }, "Recipe rated");

      emitByPolicy(ratingsEmitter, viewPolicy, emitCtx, "ratingUpdated", {
        recipeId,
        averageRating: stats.averageRating,
        ratingCount: stats.ratingCount,
      });
    })
    .catch((err) => {
      const error = err as Error;

      log.error({ err: error, userId: ctx.user.id, recipeId }, "Failed to rate recipe");
      emitRatingFailed(ctx, recipeId, error.message || "Failed to rate recipe");
    });

  return { success: true };
});

const removeRating = authedProcedure.input(RatingRemoveInputSchema).mutation(({ ctx, input }) => {
  const { recipeId } = input;

  log.debug({ userId: ctx.user.id, recipeId }, "Removing recipe rating");

  removeUserRating(ctx.user.id, recipeId)
    .then(async (result) => {
      const stats = await getAverageRating(recipeId);
      const { viewPolicy, ctx: emitCtx } = await resolveRecipeRealtimeScope(recipeId, {
        userId: ctx.user.id,
        householdKey: ctx.householdKey,
      });

      log.info({ userId: ctx.user.id, recipeId, removed: result.removed }, "Recipe rating removed");

      emitByPolicy(ratingsEmitter, viewPolicy, emitCtx, "ratingUpdated", {
        recipeId,
        averageRating: stats.averageRating,
        ratingCount: stats.ratingCount,
      });
    })
    .catch((err) => {
      const error = err as Error;

      log.error({ err: error, userId: ctx.user.id, recipeId }, "Failed to remove rating");
      emitRatingFailed(ctx, recipeId, error.message || "Failed to remove rating");
    });

  return { success: true };
});

const getUserRatingProcedure = authedProcedure
  .input(RatingGetInputSchema)
  .query(async ({ ctx, input }) => {
    const rating = await getUserRatingWithVersion(ctx.user.id, input.recipeId);

    return { recipeId: input.recipeId, userRating: rating.rating, version: rating.version };
  });

const getAverage = authedProcedure.input(RatingGetInputSchema).query(async ({ input }) => {
  const stats = await getAverageRating(input.recipeId);

  return { recipeId: input.recipeId, ...stats };
});

// RATE-01: the per-user "rated by <name> ★★★★" list + the aggregate, for an
// AUTHENTICATED viewer. assertRecipeAccess(view) runs FIRST and throws FORBIDDEN
// when the caller cannot view the recipe (per POLICY-01 / the recipe's OWN
// cookbook), so a user outside the cookbook can never read its raters' names —
// no cross-cookbook leak. The public /share/<token> route does NOT use this
// (showing member names publicly is a privacy decision deferred as RATE-02).
const getRaters = authedProcedure.input(RatingGetInputSchema).query(async ({ ctx, input }) => {
  await assertRecipeAccess(ctx, input.recipeId, "view");

  const [stats, raters] = await Promise.all([
    getAverageRating(input.recipeId),
    getRecipeRaters(input.recipeId),
  ]);

  return { recipeId: input.recipeId, ...stats, raters };
});

export const ratingsProcedures = router({
  rate,
  removeRating,
  getUserRating: getUserRatingProcedure,
  getAverage,
  getRaters,
});
