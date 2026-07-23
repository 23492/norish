import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { GroceryDto, GroceryUpdateDto } from "@norish/shared/contracts";
import {
  assignGroceryToStore,
  createGroceries,
  deleteGroceryByIds,
  getGroceriesByIds,
  getGroceryHouseholdIds,
  getRecipeInfoForGroceries,
  GroceryCreateSchema,
  GroceryDeleteSchema,
  GroceryToggleSchema,
  GroceryUpdateBaseSchema,
  listGroceriesByHousehold,
  updateGroceries,
} from "@norish/db";
import { listRecurringGroceriesByHousehold } from "@norish/db/repositories/recurring-groceries";
import {
  findBestIngredientStorePreference,
  getStoreHouseholdId,
  normalizeIngredientName,
  upsertIngredientStorePreference,
} from "@norish/db/repositories/stores";
import { trpcLogger as log } from "@norish/shared-server/logger";
import { AssignGroceryToStoreInputSchema } from "@norish/shared/contracts/zod";

import { resolveShoppingHouseholdId } from "../../helpers";
import { groceryEmitter } from "./emitter";

export type GroceryProcedureContext = {
  user: { id: string };
  household: { id: string } | null;
  userIds: string[];
  householdKey: string;
};

type GroceryMergeCandidate = {
  id: string;
  name: string | null;
  unit: string | null;
  amount: number | null;
  isDone: boolean;
  recipeIngredientId: string | null;
  recurringGroceryId: string | null;
  storeId: string | null;
  sortOrder: number;
};

function normalizeGroceryName(name: string | null): string {
  return (name ?? "").toLowerCase().trim();
}

/**
 * SHOP-02 / HOUSE-06: assert every targeted grocery belongs to the caller's
 * active shopping household. Refuses with NOT_FOUND (not FORBIDDEN) on any
 * mismatch or missing row, so the boundary never confirms a resource exists in
 * another household.
 */
async function assertGroceriesInHousehold(
  groceryIds: string[],
  householdId: string
): Promise<void> {
  const householdIds = await getGroceryHouseholdIds(groceryIds);

  if (householdIds.size !== groceryIds.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Some groceries not found" });
  }

  for (const ownerHouseholdId of householdIds.values()) {
    if (ownerHouseholdId !== householdId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Some groceries not found" });
    }
  }
}

export async function listGroceriesData(ctx: GroceryProcedureContext) {
  log.debug({ userId: ctx.user.id }, "Listing groceries");

  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) {
    return { groceries: [], recurringGroceries: [], recipeMap: {} };
  }

  const [groceries, recurringGroceries] = await Promise.all([
    listGroceriesByHousehold(householdId),
    listRecurringGroceriesByHousehold(householdId),
  ]);

  const recipeIngredientIds = groceries
    .map((grocery) => grocery.recipeIngredientId)
    .filter((id): id is string => id !== null);

  const recipeInfoMap = await getRecipeInfoForGroceries(recipeIngredientIds);
  const recipeMap: Record<string, { recipeId: string; recipeName: string }> = {};

  for (const [key, value] of recipeInfoMap) {
    recipeMap[key] = value;
  }

  log.debug(
    {
      userId: ctx.user.id,
      groceryCount: groceries.length,
      recurringCount: recurringGroceries.length,
      recipeMapSize: Object.keys(recipeMap).length,
    },
    "Groceries listed"
  );

  return { groceries, recurringGroceries, recipeMap };
}

export async function createGroceriesData(
  ctx: GroceryProcedureContext,
  input: Array<z.infer<typeof GroceryCreateSchema>>
) {
  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No shopping list household" });
  }

  const existingGroceries = await listGroceriesByHousehold(householdId, { includeDone: false });
  const existingByKey = new Map<string, GroceryMergeCandidate>();

  for (const grocery of existingGroceries) {
    const normalizedName = normalizeGroceryName(grocery.name);

    if (normalizedName && !grocery.isDone) {
      const recipeKey = grocery.recipeIngredientId ?? "manual";
      const recurringKey = grocery.recurringGroceryId ?? "none";
      const key = `${normalizedName}|${recipeKey}|${recurringKey}`;

      if (!existingByKey.has(key)) {
        existingByKey.set(key, grocery);
      }
    }
  }

  const groceriesToCreate: Array<{
    id: string;
    groceries: {
      householdId: string;
      userId: string;
      name: string | null;
      unit: string | null;
      amount: number | null;
      isDone: boolean;
      recipeIngredientId: string | null;
      recurringGroceryId: string | null;
      storeId: string | null;
    };
  }> = [];
  const groceriesToUpdate: Array<{ id: string; amount: number | null }> = [];
  const returnIds: string[] = [];

  for (const grocery of input) {
    const normalizedName = normalizeGroceryName(grocery.name);
    const recipeKey = grocery.recipeIngredientId ?? "manual";
    const recurringKey = grocery.recurringGroceryId ?? "none";
    const lookupKey = normalizedName ? `${normalizedName}|${recipeKey}|${recurringKey}` : null;
    const existing = lookupKey ? existingByKey.get(lookupKey) : null;

    const shouldMerge =
      existing && (existing.unit === grocery.unit || (!existing.unit && !grocery.unit));

    if (shouldMerge && existing) {
      const existingAmount = existing.amount ?? 1;
      const newAmount = grocery.amount ?? 1;
      const mergedAmount = existingAmount + newAmount;

      groceriesToUpdate.push({ id: existing.id, amount: mergedAmount });
      returnIds.push(existing.id);
      existingByKey.set(lookupKey!, { ...existing, amount: mergedAmount });
      continue;
    }

    const id = crypto.randomUUID();
    let storeId: string | null = grocery.storeId ?? null;

    if (!storeId && grocery.name) {
      const match = await findBestIngredientStorePreference(householdId, grocery.name);

      storeId = match?.preference.storeId ?? null;
    }

    groceriesToCreate.push({
      id,
      groceries: {
        householdId,
        userId: ctx.user.id,
        name: grocery.name,
        unit: grocery.unit,
        amount: grocery.amount,
        isDone: grocery.isDone ?? false,
        recipeIngredientId: grocery.recipeIngredientId ?? null,
        recurringGroceryId: grocery.recurringGroceryId ?? null,
        storeId,
      },
    });
    returnIds.push(id);

    if (lookupKey) {
      existingByKey.set(lookupKey, {
        id,
        name: grocery.name,
        unit: grocery.unit,
        amount: grocery.amount,
        isDone: false,
        recipeIngredientId: grocery.recipeIngredientId ?? null,
        recurringGroceryId: null,
        storeId,
        sortOrder: 0,
      });
    }
  }

  let updatedGroceries: GroceryDto[] = [];

  if (groceriesToUpdate.length > 0) {
    updatedGroceries = await updateGroceries(groceriesToUpdate);
    log.info({ userId: ctx.user.id, count: updatedGroceries.length }, "Groceries merged");

    if (updatedGroceries.length > 0) {
      groceryEmitter.emitToHousehold(ctx.householdKey, "updated", {
        changedGroceries: updatedGroceries,
      });
    }
  }

  let createdGroceries: GroceryDto[] = [];

  if (groceriesToCreate.length > 0) {
    createdGroceries = await createGroceries(groceriesToCreate, householdId);
    log.info({ userId: ctx.user.id, count: createdGroceries.length }, "Groceries created");

    if (createdGroceries.length > 0) {
      groceryEmitter.emitToHousehold(ctx.householdKey, "created", {
        groceries: createdGroceries,
      });
    }
  }

  const groceriesById = new Map<string, GroceryDto>();

  for (const grocery of [...updatedGroceries, ...createdGroceries]) {
    groceriesById.set(grocery.id, grocery);
  }

  const returnedGroceries = returnIds
    .map((id) => groceriesById.get(id))
    .filter((grocery): grocery is GroceryDto => grocery !== undefined);

  return {
    ids: returnIds,
    createdGroceries,
    updatedGroceries,
    returnedGroceries,
  };
}

export async function toggleGroceriesData(
  ctx: GroceryProcedureContext,
  input: z.infer<typeof GroceryToggleSchema>
) {
  const { groceries, isDone } = input;
  const groceryIds = groceries.map((grocery) => grocery.id);
  const versionById = new Map(groceries.map((grocery) => [grocery.id, grocery.version]));

  log.debug({ userId: ctx.user.id, count: groceryIds.length, isDone }, "Toggling groceries");

  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Groceries not found" });
  }

  await assertGroceriesInHousehold(groceryIds, householdId);

  const existingGroceries = await getGroceriesByIds(groceryIds);

  if (existingGroceries.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Groceries not found" });
  }

  const updatedGroceries = existingGroceries.map((grocery) => ({
    ...grocery,
    version: versionById.get(grocery.id) ?? grocery.version,
    isDone,
  }));

  const parsed = z.array(GroceryUpdateBaseSchema).safeParse(updatedGroceries);

  if (!parsed.success) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid data" });
  }

  const updated = await updateGroceries(parsed.data as GroceryUpdateDto[]);

  if (updated.length !== parsed.data.length) {
    log.info(
      {
        userId: ctx.user.id,
        requestedCount: parsed.data.length,
        updatedCount: updated.length,
      },
      updated.length === 0
        ? "Ignoring stale grocery toggle mutation"
        : "Grocery toggle partially applied due to stale versions"
    );
  }

  log.debug({ userId: ctx.user.id, count: updated.length, isDone }, "Groceries toggled");

  if (updated.length > 0) {
    groceryEmitter.emitToHousehold(ctx.householdKey, "updated", {
      changedGroceries: updated,
    });
  }

  return updated;
}

export async function deleteGroceriesData(
  ctx: GroceryProcedureContext,
  input: z.infer<typeof GroceryDeleteSchema>
) {
  const groceryIds = input.groceries.map((grocery) => grocery.id);

  log.info({ userId: ctx.user.id, count: groceryIds.length }, "Deleting groceries");

  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Some groceries not found" });
  }

  await assertGroceriesInHousehold(groceryIds, householdId);

  const result = await deleteGroceryByIds(input.groceries);

  if (result.staleIds.length > 0) {
    log.info(
      { userId: ctx.user.id, staleGroceryIds: result.staleIds },
      "Ignoring stale grocery delete mutations"
    );
  }

  if (result.deletedIds.length > 0) {
    log.info({ userId: ctx.user.id, count: result.deletedIds.length }, "Groceries deleted");
    groceryEmitter.emitToHousehold(ctx.householdKey, "deleted", { groceryIds: result.deletedIds });
  }

  return result;
}

export async function assignGroceryToStoreData(
  ctx: GroceryProcedureContext,
  input: z.infer<typeof AssignGroceryToStoreInputSchema>
) {
  const { groceryId, storeId, savePreference, version } = input;

  log.debug({ userId: ctx.user.id, groceryId, storeId }, "Assigning grocery to store");

  const householdId = await resolveShoppingHouseholdId(ctx);

  if (!householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Grocery not found" });
  }

  const [groceryHouseholdIds, storeHouseholdId] = await Promise.all([
    getGroceryHouseholdIds([groceryId]),
    storeId ? getStoreHouseholdId(storeId) : Promise.resolve(null),
  ]);
  const groceryHouseholdId = groceryHouseholdIds.get(groceryId);

  if (!groceryHouseholdId || groceryHouseholdId !== householdId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Grocery not found" });
  }

  if (storeId) {
    if (!storeHouseholdId || storeHouseholdId !== householdId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
    }
  }

  const [grocery] = await getGroceriesByIds([groceryId]);

  if (!grocery) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Grocery not found" });
  }

  const updated = await assignGroceryToStore(groceryId, storeId, version);

  if (!updated) {
    log.info(
      { userId: ctx.user.id, groceryId, storeId, version },
      "Ignoring stale grocery assign-to-store mutation"
    );

    return null;
  }

  log.info({ userId: ctx.user.id, groceryId, storeId }, "Grocery assigned to store");

  if (savePreference && storeId && grocery.name) {
    const normalized = normalizeIngredientName(grocery.name);

    await upsertIngredientStorePreference(householdId, ctx.user.id, normalized, storeId);
    log.debug({ userId: ctx.user.id, normalized, storeId }, "Saved ingredient store preference");
  }

  groceryEmitter.emitToHousehold(ctx.householdKey, "updated", {
    changedGroceries: [updated],
  });

  return updated;
}
