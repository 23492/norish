"use client";

// STUBBED: Cache helpers during planned_items migration (Task 7 will restore)

import type { CalendarItemViewDto } from "@/types";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export type CalendarData = Record<string, CalendarItemViewDto[]>;

export type CalendarCacheHelpers = {
  setCalendarData: (updater: (prev: CalendarData) => CalendarData) => void;
  removeRecipeFromCache: (id: string) => void;
  updateRecipeInCache: (id: string, newDate: string) => void;
  removeNoteFromCache: (id: string) => void;
  updateNoteInCache: (id: string, newDate: string) => void;
  invalidate: () => void;
};

const CALENDAR_COMBINED_PREFIX = ["calendar", "combined"] as const;
const noop = () => {};

export function useCalendarCacheHelpers(): CalendarCacheHelpers {
  const queryClient = useQueryClient();

  const setCalendarData = useCallback(
    (updater: (prev: CalendarData) => CalendarData) => {
      const queries = queryClient.getQueriesData<CalendarData>({
        queryKey: CALENDAR_COMBINED_PREFIX,
      });

      for (const [key] of queries) {
        queryClient.setQueryData<CalendarData>(key, (prev) => updater(prev ?? {}));
      }
    },
    [queryClient]
  );

  const invalidate = useCallback(() => {
    const queries = queryClient.getQueriesData<CalendarData>({
      queryKey: CALENDAR_COMBINED_PREFIX,
    });

    for (const [key] of queries) {
      queryClient.setQueryData<CalendarData>(key, {});
    }
  }, [queryClient]);

  return {
    setCalendarData,
    removeRecipeFromCache: noop,
    updateRecipeInCache: noop,
    removeNoteFromCache: noop,
    updateNoteInCache: noop,
    invalidate,
  };
}
