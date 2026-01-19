"use client";

import { createContext, useContext, useMemo, ReactNode } from "react";
import { DndContext, DragOverlay, MeasuringStrategy } from "@dnd-kit/core";
import { createPortal } from "react-dom";

import { CalendarItemOverlay } from "./calendar-item-overlay";

import {
  useCalendarDnd,
  CalendarContainerId,
  CalendarItemsState,
} from "@/hooks/calendar/use-calendar-dnd";
import { CalendarItemViewDto } from "@/types";

type DndCalendarContextValue = {
  activeId: string | null;
  overContainerId: CalendarContainerId | null;
  items: CalendarItemsState;
  getItemsForContainer: (containerId: CalendarContainerId) => string[];
  getItemById: (itemId: string) => CalendarItemViewDto | undefined;
};

const DndCalendarContext = createContext<DndCalendarContextValue | null>(null);

export function useDndCalendarContext(): DndCalendarContextValue {
  const ctx = useContext(DndCalendarContext);

  if (!ctx) throw new Error("useDndCalendarContext must be used within DndCalendarProvider");

  return ctx;
}

export function DndCalendarProvider({ children }: { children: ReactNode }) {
  const {
    sensors,
    collisionDetection,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    activeId,
    activeItem,
    overContainerId,
    items,
    getItemsForContainer,
    getItemById,
  } = useCalendarDnd();

  const contextValue = useMemo<DndCalendarContextValue>(
    () => ({
      activeId,
      overContainerId,
      items,
      getItemsForContainer,
      getItemById,
    }),
    [activeId, overContainerId, items, getItemsForContainer, getItemById]
  );

  return (
    <DndCalendarContext.Provider value={contextValue}>
      <DndContext
        collisionDetection={collisionDetection}
        measuring={{
          droppable: {
            strategy: MeasuringStrategy.Always,
          },
        }}
        sensors={sensors}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
      >
        {children}
        {typeof document !== "undefined" &&
          activeItem &&
          createPortal(
            <DragOverlay dropAnimation={{ duration: 200, easing: "ease" }}>
              <CalendarItemOverlay item={activeItem} />
            </DragOverlay>,
            document.body
          )}
      </DndContext>
    </DndCalendarContext.Provider>
  );
}
