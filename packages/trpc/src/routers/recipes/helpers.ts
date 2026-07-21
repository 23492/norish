import type { PermissionAction } from "@norish/auth/permissions";
import type { FullRecipeDTO } from "@norish/shared/contracts";

import { TRPCError } from "@trpc/server";
import { canAccessResource, resolveRecipeCookbookPolicy } from "@norish/auth/permissions";
import { getRecipeFull, getRecipeOwnerAndHousehold } from "@norish/db";
import { trpcLogger as log } from "@norish/shared-server/logger";

import { emitByPolicy } from "../../helpers";

import { recipeEmitter } from "./emitter";

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
