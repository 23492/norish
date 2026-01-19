import type { Slot } from "@/types";

export type PlannedItemWithRecipePayload =
  import("@/server/db/zodSchemas").PlannedItemWithRecipePayload;
export type SlotItemSortUpdate = import("@/server/db/zodSchemas").SlotItemSortUpdate;

export type PlannedItemType = "recipe" | "note";

export type CalendarSubscriptionEvents = {
  failed: { reason: string };

  itemCreated: { item: PlannedItemWithRecipePayload };
  itemDeleted: { itemId: string; date: string; slot: Slot };
  itemMoved: {
    item: PlannedItemWithRecipePayload;
    targetSlotItems: SlotItemSortUpdate[];
    sourceSlotItems: SlotItemSortUpdate[] | null;
    oldDate: string;
    oldSlot: Slot;
    oldSortOrder: number;
  };
  itemUpdated: { item: PlannedItemWithRecipePayload };

  globalRecipePlanned: {
    id: string;
    recipeId: string;
    recipeName: string;
    date: string;
    slot: Slot;
    userId: string;
  };
  globalRecipeDeleted: { id: string; userId: string };
  globalRecipeUpdated: {
    id: string;
    recipeId: string;
    recipeName: string;
    newDate: string;
    slot: Slot;
    userId: string;
  };
  globalNotePlanned: {
    id: string;
    title: string;
    date: string;
    slot: Slot;
    userId: string;
  };
  globalNoteDeleted: { id: string; userId: string };
  globalNoteUpdated: {
    id: string;
    title: string;
    newDate: string;
    slot: Slot;
    userId: string;
  };
};
