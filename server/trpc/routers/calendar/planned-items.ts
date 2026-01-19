import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { router } from "../../trpc";
import { authedProcedure } from "../../middleware";
import { assertHouseholdAccess } from "@/server/auth/permissions";
import {
  getPlannedItemById,
  moveItem,
  createPlannedItem,
  deletePlannedItem,
  listPlannedItemsByUserAndDateRange,
} from "@/server/db/repositories/planned-items";
import { calendarEmitter } from "./emitter";

const slotSchema = z.enum(["Breakfast", "Lunch", "Dinner", "Snack"]);
const itemTypeSchema = z.enum(["recipe", "note"]);

const listItemsInput = z.object({
  startISO: z.string(),
  endISO: z.string(),
});

const moveItemInput = z.object({
  itemId: z.string().uuid(),
  targetDate: z.string(),
  targetSlot: slotSchema,
  targetIndex: z.number().int().min(0),
});

const createItemInput = z
  .object({
    date: z.string(),
    slot: slotSchema,
    itemType: itemTypeSchema,
    recipeId: z.string().uuid().optional(),
    title: z.string().optional(),
  })
  .refine((data) => data.itemType !== "recipe" || data.recipeId, {
    message: "recipeId is required for recipe items",
  })
  .refine((data) => data.itemType !== "note" || data.title, {
    message: "title is required for note items",
  });

const deleteItemInput = z.object({
  itemId: z.string().uuid(),
});

export const plannedItemsProcedures = router({
  listItems: authedProcedure.input(listItemsInput).query(async ({ ctx, input }) => {
    const { startISO, endISO } = input;
    return listPlannedItemsByUserAndDateRange(ctx.userIds, startISO, endISO);
  }),

  moveItem: authedProcedure.input(moveItemInput).mutation(async ({ ctx, input }) => {
    const { itemId, targetDate, targetSlot, targetIndex } = input;

    const item = await getPlannedItemById(itemId);

    if (!item) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Planned item not found",
      });
    }

    await assertHouseholdAccess(ctx.user.id, item.userId);

    if (item.date === targetDate && item.slot === targetSlot && item.sortOrder === targetIndex) {
      return { success: true, moved: false };
    }

    const movedItem = await moveItem(itemId, targetDate, targetSlot, targetIndex);

    if (!movedItem) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to move item",
      });
    }

    calendarEmitter.emitToHousehold(ctx.householdKey, "itemMoved", {
      item: {
        id: movedItem.id,
        date: movedItem.date,
        slot: movedItem.slot,
        sortOrder: movedItem.sortOrder,
        itemType: movedItem.itemType,
        recipeId: movedItem.recipeId,
        title: movedItem.title,
        userId: movedItem.userId,
      },
      oldDate: item.date,
      oldSlot: item.slot,
      oldSortOrder: item.sortOrder,
    });

    return { success: true, moved: true };
  }),

  createItem: authedProcedure.input(createItemInput).mutation(async ({ ctx, input }) => {
    const { date, slot, itemType, recipeId, title } = input;

    const newItem = await createPlannedItem({
      userId: ctx.user.id,
      date,
      slot,
      itemType,
      recipeId: recipeId ?? null,
      title: title ?? null,
    });

    calendarEmitter.emitToHousehold(ctx.householdKey, "itemCreated", {
      item: {
        id: newItem.id,
        date: newItem.date,
        slot: newItem.slot,
        sortOrder: newItem.sortOrder,
        itemType: newItem.itemType,
        recipeId: newItem.recipeId,
        title: newItem.title,
        userId: newItem.userId,
      },
    });

    return { id: newItem.id };
  }),

  deleteItem: authedProcedure.input(deleteItemInput).mutation(async ({ ctx, input }) => {
    const { itemId } = input;

    const item = await getPlannedItemById(itemId);

    if (!item) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Planned item not found",
      });
    }

    await assertHouseholdAccess(ctx.user.id, item.userId);

    await deletePlannedItem(itemId);

    calendarEmitter.emitToHousehold(ctx.householdKey, "itemDeleted", {
      itemId,
      date: item.date,
      slot: item.slot,
    });

    return { success: true };
  }),
});
