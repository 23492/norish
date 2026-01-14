"use client";

import type { GroceryGroup } from "@/lib/grocery-grouping";
import type { ReactNode } from "react";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bars3Icon } from "@heroicons/react/16/solid";

interface SortableGroupItemProps {
  group: GroceryGroup;
  children: ReactNode;
}

/** Wraps a grouped grocery item with dnd-kit sortable. Shows ghost placeholder while dragging. */
export function SortableGroupItem({ group, children }: SortableGroupItemProps) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.groupKey,
    data: {
      type: "group",
      group,
    },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Drag handle offset: single-source (56px header) vs multi-source (72px header)
  const isSingleItem = group.sources.length === 1;
  const handleTopClass = isSingleItem ? "top-7" : "top-9";

  return (
    <div ref={setNodeRef} className="relative" style={style}>
      {/* Drag handle - positioned at fixed offset to align with header row center */}
      <button
        ref={setActivatorNodeRef}
        className={`absolute ${handleTopClass} left-2 z-10 flex h-8 w-8 -translate-y-1/2 cursor-grab touch-none items-center justify-center active:cursor-grabbing`}
        type="button"
        {...attributes}
        {...listeners}
      >
        <Bars3Icon className="text-default-400 h-5 w-5" />
      </button>

      {/* The actual grouped grocery item content */}
      {children}
    </div>
  );
}
