
import type { PermissionAction } from "@norish/auth/permissions";
import type { FullRecipeDTO } from "@norish/shared/contracts";

import { TRPCError } from "@trpc/server";
import { canAccessResource } from "@norish/auth/permissions";
import { getRecipePermissionPolicy } from "@norish/config/server-config-loader";
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

export async function emitRecipeFailure(
  ctx: Pick<RecipeUserContext, "user" | "householdKey">,
  reason: string,
  meta?: { recipeId?: string; url?: string }
): Promise<void> {
  const policy = await getRecipePermissionPolicy();

  emitByPolicy(
    recipeEmitter,
    policy.view,
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
  void emitRecipeFailure(ctx, error.message || `Failed to ${operation}`, meta);
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

  const canAccess = await canAccessResource(
    action,
    ctx.user.id,
    owner.userId,
    owner.householdId,
    ctx.memberHouseholdIds,
    ctx.isServerAdmin
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
    const canView = await canAccessResource(
      "view",
      ctx.user.id,
      recipe.userId,
      recipe.householdId,
      ctx.memberHouseholdIds,
      ctx.isServerAdmin
    );

    if (!canView) {
      return null;
    }
  }

  return recipe;
}
