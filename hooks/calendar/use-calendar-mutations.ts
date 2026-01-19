"use client";

import type { Slot } from "@/types";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/app/providers/trpc-provider";

export type CalendarMutationsResult = {
  createItem: (
    date: string,
    slot: Slot,
    itemType: "recipe" | "note",
    recipeId?: string,
    title?: string
  ) => void;
  deleteItem: (itemId: string) => void;
  moveItem: (itemId: string, targetDate: string, targetSlot: Slot, targetIndex: number) => void;
  isCreating: boolean;
  isDeleting: boolean;
  isMoving: boolean;
};

export function useCalendarMutations(startISO: string, endISO: string): CalendarMutationsResult {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const queryKey = trpc.calendar.listItems.queryKey({ startISO, endISO });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  const createMutation = useMutation(
    trpc.calendar.createItem.mutationOptions({
      onSuccess: () => invalidate(),
      onError: () => invalidate(),
    })
  );

  const deleteMutation = useMutation(
    trpc.calendar.deleteItem.mutationOptions({
      onSuccess: () => invalidate(),
      onError: () => invalidate(),
    })
  );

  const moveMutation = useMutation(
    trpc.calendar.moveItem.mutationOptions({
      onSuccess: () => invalidate(),
      onError: () => invalidate(),
    })
  );

  const createItem = (
    date: string,
    slot: Slot,
    itemType: "recipe" | "note",
    recipeId?: string,
    title?: string
  ) => {
    createMutation.mutate({ date, slot, itemType, recipeId, title });
  };

  const deleteItem = (itemId: string) => {
    deleteMutation.mutate({ itemId });
  };

  const moveItem = (itemId: string, targetDate: string, targetSlot: Slot, targetIndex: number) => {
    moveMutation.mutate({ itemId, targetDate, targetSlot, targetIndex });
  };

  return {
    createItem,
    deleteItem,
    moveItem,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isMoving: moveMutation.isPending,
  };
}
