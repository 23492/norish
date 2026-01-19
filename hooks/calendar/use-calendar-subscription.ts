"use client";

import type { Slot } from "@/types";

import { useSubscription } from "@trpc/tanstack-react-query";
import { useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/app/providers/trpc-provider";

type PlannedItemFromQuery = {
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

export function useCalendarSubscription(startISO: string, endISO: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const queryKey = trpc.calendar.listItems.queryKey({ startISO, endISO });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey });
  };

  const setItems = (updater: (prev: PlannedItemFromQuery[]) => PlannedItemFromQuery[]) => {
    queryClient.setQueryData<PlannedItemFromQuery[]>(queryKey, (prev) => updater(prev ?? []));
  };

  useSubscription(
    trpc.calendar.onItemCreated.subscriptionOptions(undefined, {
      onData: (payload) => {
        setItems((prev) => {
          const exists = prev.some((item) => item.id === payload.item.id);
          if (exists) return prev;

          const newItem: PlannedItemFromQuery = {
            id: payload.item.id,
            userId: payload.item.userId,
            date: payload.item.date,
            slot: payload.item.slot,
            sortOrder: payload.item.sortOrder,
            itemType: payload.item.itemType,
            recipeId: payload.item.recipeId,
            title: payload.item.title,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          return [...prev, newItem].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
            return a.sortOrder - b.sortOrder;
          });
        });
      },
    })
  );

  useSubscription(
    trpc.calendar.onItemDeleted.subscriptionOptions(undefined, {
      onData: (payload) => {
        setItems((prev) => prev.filter((item) => item.id !== payload.itemId));
      },
    })
  );

  useSubscription(
    trpc.calendar.onItemMoved.subscriptionOptions(undefined, {
      onData: (payload) => {
        setItems((prev) => {
          const updated = prev.map((item) => {
            if (item.id !== payload.item.id) return item;

            return {
              ...item,
              date: payload.item.date,
              slot: payload.item.slot,
              sortOrder: payload.item.sortOrder,
              updatedAt: new Date(),
            };
          });

          return updated.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
            return a.sortOrder - b.sortOrder;
          });
        });
      },
    })
  );

  useSubscription(
    trpc.calendar.onFailed.subscriptionOptions(undefined, {
      onData: () => {
        invalidate();
      },
    })
  );
}
