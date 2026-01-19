"use client";

import { createContext, useContext, ReactNode, useMemo, useState, useCallback } from "react";

import {
  useCalendarQuery,
  useCalendarMutations,
  useCalendarSubscription,
  type CalendarData,
} from "@/hooks/calendar";
import { Slot } from "@/types";
import { dateKey, startOfMonth, endOfMonth, addMonths } from "@/lib/helpers";

type PlannedItem = {
  id: string;
  userId: string;
  date: string;
  slot: Slot;
  sortOrder: number;
  itemType: "recipe" | "note";
  recipeId: string | null;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type Ctx = {
  plannedItemsByDate: CalendarData;
  isLoading: boolean;
  planMeal: (date: string, slot: Slot, recipeId: string) => void;
  planNote: (date: string, slot: Slot, title: string) => void;
  deletePlanned: (id: string) => void;
  moveItem: (itemId: string, targetDate: string, targetSlot: Slot, targetIndex: number) => void;
  updateItem: (itemId: string, title: string) => void;
  getItemsForSlot: (date: string, slot: Slot) => PlannedItem[];
};

const CalendarContext = createContext<Ctx | null>(null);

export function CalendarContextProvider({ children }: { children: ReactNode }) {
  const [dateRange] = useState(() => {
    const now = new Date();

    return {
      start: startOfMonth(addMonths(now, -1)),
      end: endOfMonth(addMonths(now, 1)),
    };
  });

  const startISO = dateKey(dateRange.start);
  const endISO = dateKey(dateRange.end);

  const { calendarData, isLoading } = useCalendarQuery(startISO, endISO);
  const { createItem, deleteItem, moveItem, updateItem } = useCalendarMutations(startISO, endISO);

  useCalendarSubscription(startISO, endISO);

  const planMeal = useCallback(
    (date: string, slot: Slot, recipeId: string): void => {
      createItem(date, slot, "recipe", recipeId, undefined);
    },
    [createItem]
  );

  const planNote = useCallback(
    (date: string, slot: Slot, title: string): void => {
      createItem(date, slot, "note", undefined, title);
    },
    [createItem]
  );

  const deletePlanned = useCallback(
    (id: string): void => {
      deleteItem(id);
    },
    [deleteItem]
  );

  const getItemsForSlot = useCallback(
    (date: string, slot: Slot): PlannedItem[] => {
      const items = calendarData[date] ?? [];

      return items.filter((item) => item.slot === slot).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    [calendarData]
  );

  const value = useMemo<Ctx>(
    () => ({
      plannedItemsByDate: calendarData,
      isLoading,
      planMeal,
      planNote,
      deletePlanned,
      moveItem,
      updateItem,
      getItemsForSlot,
    }),
    [
      calendarData,
      isLoading,
      planMeal,
      planNote,
      deletePlanned,
      moveItem,
      updateItem,
      getItemsForSlot,
    ]
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendarContext() {
  const ctx = useContext(CalendarContext);

  if (!ctx) throw new Error("useCalendarContext must be used within CalendarContextProvider");

  return ctx;
}
