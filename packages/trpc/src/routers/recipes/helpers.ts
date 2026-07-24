import type { PermissionAction } from "@norish/auth/permissions";
import type { FullRecipeDTO } from "@norish/shared/contracts";

import { TRPCError } from "@trpc/server";
import { canAccessResource, resolveRecipeCookbookPolicy } from "@norish/auth/permissions";
import { getRecipeFull, getRecipeOwnerAndHousehold } from "@norish/db";
import { trpcLogger as log } from "@norish/shared-server/logger";

import { emitByPolicy } from "../../helpers";

import { recipeEmitter } from "./emitter";

/**
 * Is `targetSystem` ALREADY fully materialized for this recipe? (D-27-W2-06)
 *
 * `recipes.convertMeasurements` short-circuits the (expensive, AI) conversion when
 * the target system is already present. That predicate used to look at INGREDIENTS
 * ALONE, which was correct only while both systems' rows could exist solely as the
 * output of a conversion that also wrote step prose.
 *
 * `deriveProjectionTx` breaks that assumption: it materializes BOTH systems'
 * `recipe_ingredients` from the single `.cook`, but only the NATIVE system's
 * `steps` — a converter can convert an amount, it cannot rewrite step prose
 * ("bake at 180 °C" -> "bake at 350 °F"). An ingredients-only predicate would then
 * short-circuit a recipe with no target-system prose and the user would see
 * converted ingredients beside un-converted steps.
 *
 * "Fully materialized" therefore means BOTH. Every recipe that exists today was
 * converted by the AI pass and has both, so this changes nothing for them.
 */
export function hasTargetSystemProjection(
  recipe: {
    recipeIngredients: { systemUsed: string }[];
    steps: { systemUsed: string }[];
  },
  targetSystem: string
): boolean {
  return (
    recipe.recipeIngredients.some((ri) => ri.systemUsed === targetSystem) &&
    recipe.steps.some((step) => step.systemUsed === targetSystem)
  );
}

export type RecipeUserContext = {
  user: { id: string };
  householdUserIds: string[] | null;
  memberHouseholdIds: string[];
  householdKey: string;
  isServerAdmin: boolean;
};

export function emitRecipeFailure(
  ctx: Pick<RecipeUserContext, "user" | "householdKey">,
  reason: string,
  meta?: { recipeId?: string; url?: string }
): void {
  // REALTIME-ISO-01: a failure concerns only the user whose action failed. `owner` scope
  // sends it to that user's channel — never to a cookbook, never to a broadcast.
  emitByPolicy(
    recipeEmitter,
    "owner",
    { userId: ctx.user.id, householdKey: ctx.householdKey },
    "failed",
    { reason, ...meta }
  );
}

export function handleRecipeError(
  ctx: Pick<RecipeUserContext, "user" | "householdKey">,
  err: unknown,
  operation: string,
  meta?: { recipeId?: string; url?: string }
): void {
  const error = err as Error;

  log.error({ err: error, userId: ctx.user.id, ...meta }, `Failed to ${operation}`);
  emitRecipeFailure(ctx, error.message || `Failed to ${operation}`, meta);
}

export async function assertRecipeAccess(
  ctx: Pick<RecipeUserContext, "user" | "memberHouseholdIds" | "isServerAdmin">,
  recipeId: string,
  action: PermissionAction
): Promise<void> {
  const owner = await getRecipeOwnerAndHousehold(recipeId);

  if (owner === null || owner.userId === null) {
    log.debug({ recipeId }, `${action} orphaned recipe`);

    return;
  }

  // Resolve the policy + admin from the RECIPE'S OWN cookbook (never the active
  // one) so the per-cookbook boundary stays keyed to the recipe's household.
  const { policy, adminUserId } = await resolveRecipeCookbookPolicy(owner.householdId);

  const canAccess = canAccessResource(
    action,
    ctx.user.id,
    owner.userId,
    owner.householdId,
    ctx.memberHouseholdIds,
    ctx.isServerAdmin,
    policy,
    adminUserId
  );

  if (!canAccess) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to access this recipe",
    });
  }
}

/**
 * Authorize a move-recipe-between-cookbooks request (CKBK-MOVE-01).
 *
 * SECURITY (HOUSE-06 / POLICY-01) — a move must be allowed on BOTH ends:
 * - SOURCE: the actor must have POLICY-01 EDIT rights on the recipe in its OWN
 *   cookbook (`assertRecipeAccess(edit)` — owner, or the source cookbook admin
 *   when edit=household/everyone). This also guarantees the actor can SEE it: a
 *   non-member fails the edit gate before any move happens ("you cannot move
 *   what you cannot see").
 * - DESTINATION: a household destination requires MEMBERSHIP
 *   (`ctx.memberHouseholdIds`) — membership is the right to add (Phase 2: any
 *   member creates in a cookbook). A Personal destination (null) requires the
 *   actor to be the recipe OWNER — Personal is the owner's own owner-only space.
 * - Server admin bypasses both (parity with `canAccessResource`).
 *
 * A move never widens who may access a recipe beyond the destination's existing
 * members, and can never target a cookbook the actor is not authorised on.
 *
 * Returns the resolved source household + owner for the caller's realtime scoping.
 */
export async function assertRecipeMoveAllowed(
  ctx: Pick<RecipeUserContext, "user" | "memberHouseholdIds" | "isServerAdmin">,
  recipeId: string,
  destinationHouseholdId: string | null
): Promise<{ sourceHouseholdId: string | null; ownerId: string | null }> {
  // SOURCE gate: POLICY-01 edit rights on the recipe's own cookbook.
  await assertRecipeAccess(ctx, recipeId, "edit");

  const owner = await getRecipeOwnerAndHousehold(recipeId);

  if (owner === null) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Recipe not found" });
  }

  // No-op: already in the requested cookbook. Reject rather than emit spurious
  // move events.
  if (owner.householdId === destinationHouseholdId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Recipe is already in this cookbook",
    });
  }

  if (ctx.isServerAdmin) {
    return { sourceHouseholdId: owner.householdId, ownerId: owner.userId };
  }

  // DESTINATION gate.
  if (destinationHouseholdId === null) {
    // Personal is the actor's own owner-only space — only the owner may place it there.
    if (owner.userId !== ctx.user.id) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the recipe owner can move it to Personal",
      });
    }
  } else if (!ctx.memberHouseholdIds.includes(destinationHouseholdId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of the destination cookbook",
    });
  }

  return { sourceHouseholdId: owner.householdId, ownerId: owner.userId };
}

export async function findRecipeForViewer(
  ctx: Pick<RecipeUserContext, "user" | "memberHouseholdIds" | "isServerAdmin">,
  recipeId: string
): Promise<FullRecipeDTO | null> {
  const recipe = await getRecipeFull(recipeId);

  if (!recipe) {
    return null;
  }

  if (recipe.userId) {
    // Resolve the policy + admin from the recipe's OWN cookbook (HOUSE-06).
    const { policy, adminUserId } = await resolveRecipeCookbookPolicy(recipe.householdId);

    const canView = canAccessResource(
      "view",
      ctx.user.id,
      recipe.userId,
      recipe.householdId,
      ctx.memberHouseholdIds,
      ctx.isServerAdmin,
      policy,
      adminUserId
    );

    if (!canView) {
      return null;
    }
  }

  return recipe;
}
