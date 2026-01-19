"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { PlusIcon } from "@heroicons/react/16/solid";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { CalendarItem } from "./calendar-item";
import { useDndCalendarContext } from "./dnd-calendar-provider";

import { useCalendarContext } from "@/app/(app)/calendar/context";
import { Slot } from "@/types";

type CalendarSlotProps = {
  date: string;
  slot: Slot;
  onAddClick: () => void;
  onEditNote: (id: string, title: string, date: string, slot: Slot) => void;
};

export function CalendarSlot({ date, slot, onAddClick, onEditNote }: CalendarSlotProps) {
  const tSlots = useTranslations("common.slots");
  const tMobile = useTranslations("calendar.mobile");
  const { deletePlanned } = useCalendarContext();
  const router = useRouter();

  const containerId = `${date}_${slot}`;
  const { setNodeRef } = useDroppable({
    id: containerId,
  });

  const { getItemsForContainer, getItemById } = useDndCalendarContext();
  const itemIds = getItemsForContainer(containerId);

  const handleDelete = (id: string) => {
    deletePlanned(id);
  };

  const handleNavigate = (recipeId: string) => {
    router.push(`/recipes/${recipeId}`);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-default-600 text-sm font-medium">{tSlots(slot.toLowerCase())}</span>
        <Button
          isIconOnly
          className="text-default-400 data-[hover=true]:text-primary"
          size="sm"
          variant="light"
          onPress={onAddClick}
        >
          <PlusIcon className="h-5 w-5" />
        </Button>
      </div>

      <div ref={setNodeRef} className="min-h-[20px] rounded-lg p-1">
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {itemIds.length === 0 ? (
            <p className="text-default-300 py-2 text-sm italic">{tMobile("nothingPlanned")}</p>
          ) : (
            itemIds.map((itemId) => {
              const item = getItemById(itemId);

              if (!item) return null;

              return (
                <CalendarItem
                  key={item.id}
                  item={item}
                  onDelete={() => handleDelete(item.id)}
                  onEdit={
                    item.itemType === "note"
                      ? () => onEditNote(item.id, item.title, date, slot)
                      : undefined
                  }
                  onNavigate={
                    item.itemType === "recipe" ? () => handleNavigate(item.recipeId) : undefined
                  }
                />
              );
            })
          )}
        </SortableContext>
      </div>
    </div>
  );
}
