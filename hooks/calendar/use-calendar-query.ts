"use client";

// STUBBED: Query disabled during planned_items migration (Task 7 will restore)

import type { CalendarItemViewDto } from "@/types";
import type { QueryKey } from "@tanstack/react-query";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useMemo, useCallback } from "react";

const CALENDAR_COMBINED_PREFIX = ["calendar", "combined"] as const;

export type CalendarData = Record<string, CalendarItemViewDto[]>;

export type CalendarQueryResult = {
  calendarData: CalendarData;
  isLoading: boolean;
  error: unknown;
  recipesQueryKey: QueryKey;
  notesQueryKey: QueryKey;
  setCalendarData: (updater: (prev: CalendarData) => CalendarData) => void;
  removeRecipeFromCache: (id: string) => void;
  updateRecipeInCache: (id: string, newDate: string) => void;
  removeNoteFromCache: (id: string) => void;
  updateNoteInCache: (id: string, newDate: string) => void;
  invalidate: () => void;
};

const noop = () => {};

export function useCalendarQuery(startISO: string, endISO: string): CalendarQueryResult {
  const queryClient = useQueryClient();

  const recipesQueryKey: QueryKey = ["calendar", "listRecipes", { startISO, endISO }];
  const notesQueryKey: QueryKey = ["calendar", "listNotes", { startISO, endISO }];
  const combinedQueryKey = useMemo(
    () => [...CALENDAR_COMBINED_PREFIX, startISO, endISO],
    [startISO, endISO]
  );

  const optimisticQuery = useQuery({
    queryKey: combinedQueryKey,
    queryFn: () => ({}) as CalendarData,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const calendarData = useMemo(() => optimisticQuery.data ?? {}, [optimisticQuery.data]);

  const setCalendarData = useCallback(
    (updater: (prev: CalendarData) => CalendarData) => {
      queryClient.setQueryData<CalendarData>(combinedQueryKey, (prev) => updater(prev ?? {}));
    },
    [queryClient, combinedQueryKey]
  );

  const invalidate = useCallback(() => {
    queryClient.setQueryData<CalendarData>(combinedQueryKey, {});
  }, [queryClient, combinedQueryKey]);

  return {
    calendarData,
    isLoading: false,
    error: null,
    recipesQueryKey,
    notesQueryKey,
    setCalendarData,
    removeRecipeFromCache: noop,
    updateRecipeInCache: noop,
    removeNoteFromCache: noop,
    updateNoteInCache: noop,
    invalidate,
  };
}
