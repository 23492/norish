import type z from "zod";
import { TRPCError } from "@trpc/server";

import {
  checkStoreNameExistsInHousehold,
  createStore,
  listStoresByHousehold,
} from "@norish/db/repositories/stores";
import { trpcLogger as log } from "@norish/shared-server/logger";
import { StoreCreateSchema } from "@norish/shared/contracts/zod";

import { resolveShoppingHouseholdId } from "../../helpers";
import { storeEmitter } from "./emitter";

export type StoreProcedureContext = {
  user: { id: string };
  household: { id: string } | null;
  userIds: string[];
  householdKey: string;
};

export async function listStoresData(ctx: StoreProcedureContext) {
  log.debug({ userId: ctx.user.id }, "Listing stores");

  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) return [];

  const stores = await listStoresByHousehold(householdId);

  log.debug({ userId: ctx.user.id, storeCount: stores.length }, "Stores listed");

  return stores;
}

export async function createStoreData(
  ctx: StoreProcedureContext,
  input: z.infer<typeof StoreCreateSchema>
) {
  const storeId = crypto.randomUUID();

  log.info({ userId: ctx.user.id, storeName: input.name }, "Creating store");

  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No shopping list household" });
  }

  const exists = await checkStoreNameExistsInHousehold(input.name, householdId);

  if (exists) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A store with this name already exists",
    });
  }

  const storeData = {
    householdId,
    userId: ctx.user.id,
    name: input.name,
    color: input.color ?? "primary",
    icon: input.icon ?? "ShoppingBagIcon",
    sortOrder: 0,
  };

  const createdStore = await createStore(storeId, storeData);

  log.info({ userId: ctx.user.id, storeId: createdStore.id }, "Store created");
  storeEmitter.emitToHousehold(ctx.householdKey, "created", {
    store: createdStore,
  });

  return createdStore;
}
