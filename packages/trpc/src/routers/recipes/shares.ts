import type {
  RecipeShareDto,
  RecipeShareLifecycleEventDto,
} from "@norish/shared/contracts/dto/recipe-shares";

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getRecipePermissionPolicy,
  getTimerKeywords,
  getUnits,
  isTimersEnabled,
} from "@norish/config/server-config-loader";
import { UnitsMapSchema } from "@norish/config/zod/server-config";
import {
  createRecipeShare,
  deleteRecipeShare,
  getPublicRecipeView,
  getRecipeShareById,
  getRecipeShareInventoryByUserId,
  getRecipeShareInventoryForAdmin,
  getRecipeSharesByUserId,
  getRecipeShareStatus,
  reactivateRecipeShare,
  revokeRecipeShare,
  updateRecipeShare,
} from "@norish/db/repositories/recipe-shares";
import {
  copyRecipeForSave,
  countActiveRecipeShares,
  dashboardRecipe,
  getRecipeFull,
  getRecipeVisibility,
  setRecipeVisibility,
} from "@norish/db/repositories/recipes";
import { copyRecipeImagesDir } from "@norish/shared-server/media/storage";
import { trpcLogger as log } from "@norish/shared-server/logger";
import { TimerKeywordsSchema } from "@norish/shared/contracts/zod";
import {
  AdminRecipeShareInventorySchema,
  CreateRecipeShareInputSchema,
  DeleteRecipeShareInputSchema,
  GetRecipeShareInputSchema,
  ListRecipeSharesInputSchema,
  PublicRecipeViewSchema,
  ReactivateRecipeShareInputSchema,
  RecipeShareCreatedSchema,
  RecipeShareDeleteResultSchema,
  RecipeShareInventorySchema,
  RecipeShareLifecycleEventSchema,
  RecipeShareMutationResultSchema,
  RecipeShareSummarySchema,
  RevokeRecipeShareInputSchema,
  SaveSharedRecipeResultSchema,
  UpdateRecipeShareInputSchema,
} from "@norish/shared/contracts/zod/recipe-shares";
import {
  RecipeVisibilityResultSchema,
  SetRecipeVisibilityInputSchema,
} from "@norish/shared/contracts/zod/recipe";

import { emitByPolicy } from "../../helpers";
import {
  adminProcedure,
  authedProcedure,
  authedSharedRecipeProcedure,
  sharedRecipeProcedure,
} from "../../middleware";
import { router } from "../../trpc";

import { recipeEmitter } from "./emitter";
import { assertRecipeAccess } from "./helpers";

type ShareMutationContext = {
  user: { id: string };
  householdKey: string;
};

const recipeShareEventsByType = {
  created: "shareCreated",
  updated: "shareUpdated",
  revoked: "shareRevoked",
  reactivated: "shareReactivated",
  deleted: "shareDeleted",
} as const;

function toSummary(share: RecipeShareDto) {
  return RecipeShareSummarySchema.parse({
    ...share,
    status: getRecipeShareStatus(share),
  });
}

function toRecipeShareLifecycleEvent(
  share: Pick<RecipeShareDto, "id" | "recipeId" | "version">,
  type: RecipeShareLifecycleEventDto["type"]
) {
  return RecipeShareLifecycleEventSchema.parse({
    type,
    recipeId: share.recipeId,
    shareId: share.id,
    version: share.version,
  });
}

async function emitRecipeShareEvent(
  ctx: ShareMutationContext,
  share: Pick<RecipeShareDto, "id" | "recipeId" | "version">,
  type: RecipeShareLifecycleEventDto["type"]
) {
  const policy = await getRecipePermissionPolicy();

  emitByPolicy(
    recipeEmitter,
    policy.view,
    { userId: ctx.user.id, householdKey: ctx.householdKey },
    recipeShareEventsByType[type],
    toRecipeShareLifecycleEvent(share, type)
  );
}

/**
 * Promote a recipe to `public` after a share link is created. Visibility is the
 * explicit gate that the public route enforces; creating a share link is the
 * user action that opts the recipe in. Tolerates a concurrent version bump by
 * re-reading once. No-op if the recipe is already public.
 */
async function markRecipePublic(recipeId: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await getRecipeVisibility(recipeId);

    if (!current || current.visibility === "public") {
      return;
    }

    const result = await setRecipeVisibility(recipeId, "public", current.version);

    if (!result.stale) {
      return;
    }
  }
}

/**
 * Return a recipe to `private` once it has no remaining ACTIVE share links
 * (after a revoke/delete). A recipe with no live public link must not stay
 * publicly reachable. No-op while any active share remains, or if already
 * private. Tolerates a concurrent version bump by re-reading once.
 */
async function revertRecipePrivateIfNoActiveShares(recipeId: string): Promise<void> {
  const activeShares = await countActiveRecipeShares(recipeId);

  if (activeShares > 0) {
    return;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await getRecipeVisibility(recipeId);

    if (!current || current.visibility !== "public") {
      return;
    }

    const result = await setRecipeVisibility(recipeId, "private", current.version);

    if (!result.stale) {
      return;
    }
  }
}

async function getOwnedShareOrThrow(ctx: { user: { id: string } }, shareId: string) {
  const share = await getRecipeShareById(shareId);

  if (!share || share.userId !== ctx.user.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Recipe share not found" });
  }

  return share;
}

async function getManageableShareOrThrow(
  ctx: { user: { id: string }; isServerAdmin: boolean },
  shareId: string
) {
  const share = await getRecipeShareById(shareId);

  if (!share || (share.userId !== ctx.user.id && !ctx.isServerAdmin)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Recipe share not found" });
  }

  return share;
}

const create = authedProcedure
  .input(CreateRecipeShareInputSchema)
  .output(RecipeShareCreatedSchema)
  .mutation(async ({ ctx, input }) => {
    await assertRecipeAccess(ctx, input.recipeId, "edit");

    log.info({ userId: ctx.user.id, recipeId: input.recipeId }, "Creating recipe share");

    const share = await createRecipeShare(ctx.user.id, input);

    // Creating a share link opts the recipe into `public` visibility (the gate
    // the public route enforces).
    await markRecipePublic(input.recipeId);

    await emitRecipeShareEvent(ctx, share, "created");

    return share;
  });

const list = authedProcedure
  .input(ListRecipeSharesInputSchema)
  .output(z.array(RecipeShareSummarySchema))
  .query(async ({ ctx, input }) => {
    await assertRecipeAccess(ctx, input.recipeId, "edit");

    return getRecipeSharesByUserId(ctx.user.id, input.recipeId);
  });

const listMine = authedProcedure
  .output(z.array(RecipeShareInventorySchema))
  .query(async ({ ctx }) => getRecipeShareInventoryByUserId(ctx.user.id));

const listAdmin = adminProcedure
  .output(z.array(AdminRecipeShareInventorySchema))
  .query(async () => getRecipeShareInventoryForAdmin());

const get = authedProcedure
  .input(GetRecipeShareInputSchema)
  .output(RecipeShareSummarySchema)
  .query(async ({ ctx, input }) => {
    const share = await getOwnedShareOrThrow(ctx, input.id);

    await assertRecipeAccess(ctx, share.recipeId, "edit");

    return toSummary(share);
  });

const update = authedProcedure
  .input(UpdateRecipeShareInputSchema)
  .output(RecipeShareMutationResultSchema)
  .mutation(async ({ ctx, input }) => {
    const share = await getOwnedShareOrThrow(ctx, input.id);

    await assertRecipeAccess(ctx, share.recipeId, "edit");

    const result = await updateRecipeShare(input);

    if (result.stale || !result.value) {
      return { ...toSummary(share), stale: true };
    }

    await emitRecipeShareEvent(ctx, result.value, "updated");

    return { ...result.value, stale: false };
  });

const revoke = authedProcedure
  .input(RevokeRecipeShareInputSchema)
  .output(RecipeShareMutationResultSchema)
  .mutation(async ({ ctx, input }) => {
    const share = await getManageableShareOrThrow(ctx, input.id);

    if (!ctx.isServerAdmin) {
      await assertRecipeAccess(ctx, share.recipeId, "edit");
    }

    const result = await revokeRecipeShare(input.id, input.version);

    if (result.stale || !result.value) {
      return { ...toSummary(share), stale: true };
    }

    // If this was the last live public link, return the recipe to `private`.
    await revertRecipePrivateIfNoActiveShares(share.recipeId);

    await emitRecipeShareEvent(ctx, result.value, "revoked");

    return { ...result.value, stale: false };
  });

const reactivate = authedProcedure
  .input(ReactivateRecipeShareInputSchema)
  .output(RecipeShareMutationResultSchema)
  .mutation(async ({ ctx, input }) => {
    const share = await getManageableShareOrThrow(ctx, input.id);

    if (!ctx.isServerAdmin) {
      await assertRecipeAccess(ctx, share.recipeId, "edit");
    }

    const result = await reactivateRecipeShare(input.id, input.version);

    if (result.stale || !result.value) {
      return { ...toSummary(share), stale: true };
    }

    await emitRecipeShareEvent(ctx, result.value, "reactivated");

    return { ...result.value, stale: false };
  });

const remove = authedProcedure
  .input(DeleteRecipeShareInputSchema)
  .output(RecipeShareDeleteResultSchema)
  .mutation(async ({ ctx, input }) => {
    const share = await getManageableShareOrThrow(ctx, input.id);

    if (!ctx.isServerAdmin) {
      await assertRecipeAccess(ctx, share.recipeId, "edit");
    }

    const result = await deleteRecipeShare(input.id, input.version);

    if (!result.stale) {
      // If this was the last live public link, return the recipe to `private`.
      await revertRecipePrivateIfNoActiveShares(share.recipeId);

      await emitRecipeShareEvent(
        ctx,
        { id: share.id, recipeId: share.recipeId, version: share.version },
        "deleted"
      );
    }

    return { success: true, stale: result.stale };
  });

const setVisibility = authedProcedure
  .input(SetRecipeVisibilityInputSchema)
  .output(RecipeVisibilityResultSchema)
  .mutation(async ({ ctx, input }) => {
    // Setting visibility requires EDIT access on the recipe (owner or cookbook
    // admin), resolved against the recipe's OWN cookbook policy (POLICY-01). The
    // visibility flag sits ON TOP of that boundary and never widens cross-cookbook
    // access — it only governs whether the public /share route may serve it.
    await assertRecipeAccess(ctx, input.recipeId, "edit");

    const result = await setRecipeVisibility(input.recipeId, input.visibility, input.version);

    if (result.stale || !result.value) {
      const current = await getRecipeVisibility(input.recipeId);

      return {
        recipeId: input.recipeId,
        visibility: current?.visibility ?? input.visibility,
        version: current?.version ?? input.version,
        stale: true,
      };
    }

    const updatedRecipe = await getRecipeFull(input.recipeId);

    if (updatedRecipe) {
      const policy = await getRecipePermissionPolicy();

      emitByPolicy(
        recipeEmitter,
        policy.view,
        { userId: ctx.user.id, householdKey: ctx.householdKey },
        "updated",
        { recipe: updatedRecipe }
      );
    }

    return {
      recipeId: input.recipeId,
      visibility: result.value.visibility,
      version: result.value.version,
      stale: false,
    };
  });

const saveShared = authedSharedRecipeProcedure
  .output(SaveSharedRecipeResultSchema)
  .mutation(async ({ ctx }) => {
    // Authorization (SHARE-02): the recipe is resolved by
    // authedSharedRecipeProcedure, which runs the SAME token->recipe gate as the
    // public route — the token must resolve to a PUBLIC recipe via a valid,
    // non-expired, non-revoked share. A user can only save a recipe reachable
    // through a valid /share/<token> (public); they CANNOT save an arbitrary or
    // private recipe id. No recipe id is accepted from the client.
    const source = ctx.sharedRecipe.recipe;
    const targetHouseholdId = ctx.household?.id ?? null;
    const newRecipeId = randomUUID();

    log.info(
      { userId: ctx.user.id, sourceRecipeId: source.id, newRecipeId, householdId: targetHouseholdId },
      "Saving shared recipe into the saver's active cookbook"
    );

    // Give the saved copy its OWN media files (best-effort) so it survives the
    // original being deleted; copyRecipeForSave rewrites the URLs onto the new id.
    await copyRecipeImagesDir(source.id, newRecipeId);

    // Deep copy into the SAVER's active cookbook (household_id = ctx.household?.id
    // ?? null), owned by the saver. NOT a reference to the original, and NOT in
    // the source's cookbook — per-cookbook scoping is preserved.
    const createdId = await copyRecipeForSave(
      source,
      ctx.user.id,
      targetHouseholdId,
      newRecipeId
    );

    if (!createdId) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to save recipe" });
    }

    // Surface the new recipe live in the saver's cookbook (same as a create).
    const dashboardDto = await dashboardRecipe(createdId);

    if (dashboardDto) {
      const policy = await getRecipePermissionPolicy();

      emitByPolicy(
        recipeEmitter,
        policy.view,
        { userId: ctx.user.id, householdKey: ctx.householdKey },
        "created",
        { recipe: dashboardDto }
      );
    }

    return { recipeId: createdId };
  });

const getShared = sharedRecipeProcedure.output(PublicRecipeViewSchema).query(async ({ ctx }) => {
  const publicRecipe = await getPublicRecipeView(
    ctx.sharedRecipe.share.recipeId,
    ctx.sharedRecipe.token
  );

  if (!publicRecipe) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Shared recipe not found" });
  }

  return publicRecipe;
});

const sharePublicConfig = sharedRecipeProcedure
  .output(
    z.object({
      units: UnitsMapSchema,
      timersEnabled: z.boolean(),
      timerKeywords: TimerKeywordsSchema,
    })
  )
  .query(async () => {
    const [units, timersEnabled, timerKeywords] = await Promise.all([
      getUnits(),
      isTimersEnabled(),
      getTimerKeywords(),
    ]);

    return {
      units,
      timersEnabled,
      timerKeywords,
    };
  });

export const recipeSharesProcedures = router({
  shareCreate: create,
  shareList: list,
  shareListMine: listMine,
  shareListAdmin: listAdmin,
  shareGet: get,
  shareUpdate: update,
  shareRevoke: revoke,
  shareReactivate: reactivate,
  shareDelete: remove,
  shareSetVisibility: setVisibility,
  saveShared,
  getShared,
  sharePublicConfig,
});
