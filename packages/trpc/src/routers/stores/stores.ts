import { TRPCError } from "@trpc/server";

import {
  checkStoreNameExistsInHousehold,
  countGroceriesInStore,
  deleteStore,
  getStoreHouseholdId,
  reorderStores,
  updateStore,
} from "@norish/db/repositories/stores";
import { trpcLogger as log } from "@norish/shared-server/logger";
import {
  StoreCreateSchema,
  StoreDeleteSchema,
  StoreReorderSchema,
  StoreUpdateInputSchema,
} from "@norish/shared/contracts/zod";

import { resolveShoppingHouseholdId } from "../../helpers";
import { authedProcedure } from "../../middleware";
import { router } from "../../trpc";
import { groceryEmitter } from "../groceries/emitter";
import { storeEmitter } from "./emitter";
import { createStoreData, listStoresData } from "./stores-helpers";
import {
  createStoreOutputSchema,
  listStoresOutputSchema,
  storeIdInputSchema,
} from "./stores-openapi-types";

/**
 * SHOP-02 / HOUSE-06: assert the store belongs to the caller's active shopping
 * household. Returns that household id. Refuses with NOT_FOUND on any mismatch.
 */
async function assertStoreInHousehold(
  ctx: { user: { id: string }; household: { id: string } | null },
  storeId: string
): Promise<string> {
  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }

  const storeHouseholdId = await getStoreHouseholdId(storeId);

  if (!storeHouseholdId || storeHouseholdId !== householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }

  return householdId;
}

const list = authedProcedure.query(async ({ ctx }) => {
  return listStoresData(ctx);
});

const create = authedProcedure.input(StoreCreateSchema).mutation(async ({ ctx, input }) => {
  try {
    const createdStore = await createStoreData(ctx, input);

    return createdStore.id;
  } catch (err) {
    log.error({ err, userId: ctx.user.id }, "Failed to create store");
    throw err;
  }
});

export const listStoresProcedure = authedProcedure
  .meta({
    openapi: {
      method: "GET",
      path: "/stores",
      protect: true,
      tags: ["Stores"],
      summary: "List stores",
      errorResponses: {
        401: "Missing or invalid API credentials",
      },
    },
  })
  .output(listStoresOutputSchema)
  .query(async ({ ctx }) => listStoresData(ctx));

export const createStoreProcedure = authedProcedure
  .meta({
    openapi: {
      method: "POST",
      path: "/stores",
      protect: true,
      tags: ["Stores"],
      summary: "Create a store",
      errorResponses: {
        401: "Missing or invalid API credentials",
        409: "A store with this name already exists",
      },
    },
  })
  .input(StoreCreateSchema)
  .output(createStoreOutputSchema)
  .mutation(async ({ ctx, input }) => createStoreData(ctx, input));

const update = authedProcedure.input(StoreUpdateInputSchema).mutation(async ({ ctx, input }) => {
  log.debug({ userId: ctx.user.id, storeId: input.id }, "Updating store");

  // Check ownership (household-scoped)
  const householdId = await assertStoreInHousehold(ctx, input.id);

  // Check for duplicate name if name is being changed
  if (input.name) {
    const exists = await checkStoreNameExistsInHousehold(input.name, householdId, input.id);

    if (exists) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A store with this name already exists",
      });
    }
  }

  try {
    const updatedStore = await updateStore(input);

    if (!updatedStore) {
      log.info(
        { userId: ctx.user.id, storeId: input.id, version: input.version },
        "Ignoring stale store update mutation"
      );

      return input.id;
    }

    log.info({ userId: ctx.user.id, storeId: updatedStore.id }, "Store updated");
    storeEmitter.emitToHousehold(ctx.householdKey, "updated", {
      store: updatedStore,
    });
  } catch (err) {
    log.error({ err, userId: ctx.user.id, storeId: input.id }, "Failed to update store");
  }

  return input.id;
});

const remove = authedProcedure.input(StoreDeleteSchema).mutation(async ({ ctx, input }) => {
  const { storeId, version, deleteGroceries, grocerySnapshot } = input;

  log.info(
    { userId: ctx.user.id, storeId, deleteGroceries, hasSnapshot: !!grocerySnapshot },
    "Deleting store"
  );

  // Check ownership (household-scoped)
  await assertStoreInHousehold(ctx, storeId);

  deleteStore(storeId, version, deleteGroceries, grocerySnapshot)
    .then(({ deletedGroceryIds, storeDeleted, stale }) => {
      if (stale) {
        log.info({ userId: ctx.user.id, storeId, version }, "Ignoring stale store delete mutation");

        return;
      }

      log.info(
        {
          userId: ctx.user.id,
          storeId,
          deletedGroceryCount: deletedGroceryIds.length,
          storeDeleted,
        },
        "Store delete processed"
      );

      if (storeDeleted) {
        // Emit store deleted event
        storeEmitter.emitToHousehold(ctx.householdKey, "deleted", {
          storeId,
          deletedGroceryIds,
        });
      }

      // If groceries were deleted, also emit grocery deleted event
      if (deletedGroceryIds.length > 0) {
        groceryEmitter.emitToHousehold(ctx.householdKey, "deleted", {
          groceryIds: deletedGroceryIds,
        });
      }
    })
    .catch((err) => {
      log.error({ err, userId: ctx.user.id, storeId }, "Failed to delete store");
    });

  return storeId;
});

const reorder = authedProcedure.input(StoreReorderSchema).mutation(async ({ ctx, input }) => {
  const storeUpdates = input.stores;

  log.debug({ userId: ctx.user.id, storeCount: storeUpdates.length }, "Reordering stores");

  try {
    // HOUSE-06: every store being reordered must belong to the caller's household.
    const householdId = await resolveShoppingHouseholdId(ctx);

    if (!householdId) {
      return storeUpdates.map((s) => s.id);
    }

    for (const s of storeUpdates) {
      const storeHouseholdId = await getStoreHouseholdId(s.id);

      if (!storeHouseholdId || storeHouseholdId !== householdId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
      }
    }

    const reorderedStores = await reorderStores(storeUpdates);

    if (reorderedStores.length === 0) {
      log.info(
        { userId: ctx.user.id, requestedStoreCount: storeUpdates.length },
        "Ignoring stale store reorder mutation"
      );

      return storeUpdates.map((s) => s.id);
    }

    if (reorderedStores.length !== storeUpdates.length) {
      log.info(
        {
          userId: ctx.user.id,
          requestedStoreCount: storeUpdates.length,
          appliedStoreCount: reorderedStores.length,
        },
        "Store reorder partially applied due to stale versions"
      );
    } else {
      log.info({ userId: ctx.user.id, storeCount: reorderedStores.length }, "Stores reordered");
    }

    storeEmitter.emitToHousehold(ctx.householdKey, "reordered", {
      stores: reorderedStores,
    });
  } catch (err) {
    log.error({ err, userId: ctx.user.id }, "Failed to reorder stores");
  }

  return storeUpdates.map((s) => s.id);
});

const getGroceryCount = authedProcedure.input(storeIdInputSchema).query(async ({ ctx, input }) => {
  await assertStoreInHousehold(ctx, input.storeId);

  return countGroceriesInStore(input.storeId);
});

export const storesProcedures = router({
  list,
  create,
  update,
  delete: remove,
  reorder,
  getGroceryCount,
});
