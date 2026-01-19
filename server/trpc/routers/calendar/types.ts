import type { PlannedRecipeViewDto, NoteViewDto, Slot } from "@/types";

type PlannedItemType = "recipe" | "note";

interface PlannedItemEventPayload {
  id: string;
  date: string;
  slot: Slot;
  sortOrder: number;
  itemType: PlannedItemType;
  recipeId: string | null;
  title: string | null;
  userId: string;
}

export type CalendarSubscriptionEvents = {
  recipePlanned: { plannedRecipe: PlannedRecipeViewDto };
  recipeDeleted: { plannedRecipeId: string; date: string };
  recipeUpdated: { plannedRecipe: PlannedRecipeViewDto; oldDate: string };
  notePlanned: { note: NoteViewDto };
  noteDeleted: { noteId: string; date: string };
  noteUpdated: { note: NoteViewDto; oldDate: string };
  failed: { reason: string };

  itemCreated: { item: PlannedItemEventPayload };
  itemDeleted: { itemId: string; date: string; slot: Slot };
  itemMoved: {
    item: PlannedItemEventPayload;
    oldDate: string;
    oldSlot: Slot;
    oldSortOrder: number;
  };

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
