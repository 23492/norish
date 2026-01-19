"use client";

// STUBBED: Mutations disabled during planned_items migration (Task 7 will restore)

import type { Slot } from "@/types";

export type CalendarMutationsResult = {
  createPlannedRecipe: (
    date: string,
    slot: Slot,
    recipeId: string,
    recipeName: string,
    recipeImage: string | null,
    servings: number | null,
    calories: number | null,
    recipeTags?: string[]
  ) => void;
  deletePlannedRecipe: (id: string, date: string) => void;
  updatePlannedRecipeDate: (id: string, newDate: string, oldDate: string) => void;
  createNote: (date: string, slot: Slot, title: string) => void;
  deleteNote: (id: string, date: string) => void;
  updateNoteDate: (id: string, newDate: string, oldDate: string) => void;
  updateNoteTitle: (id: string, date: string, slot: Slot, title: string) => void;
  updateNote: (
    id: string,
    oldDate: string,
    oldSlot: Slot,
    newDate: string,
    newSlot: Slot,
    title: string
  ) => void;
};

const noop = () => {};

export function useCalendarMutations(_startISO: string, _endISO: string): CalendarMutationsResult {
  return {
    createPlannedRecipe: noop,
    deletePlannedRecipe: noop,
    updatePlannedRecipeDate: noop,
    createNote: noop,
    deleteNote: noop,
    updateNoteDate: noop,
    updateNoteTitle: noop,
    updateNote: noop,
  };
}
