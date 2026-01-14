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

/**
 * Wraps a grouped grocery item to make it sortable with dnd-kit.
 * Provides a drag handle and applies transform/transition for smooth animations.
 *
 * When dragging:
 * - The original group shows at 50% opacity as a "ghost" placeholder
 * - The DragOverlay shows the actual dragged group following the cursor
 * - Other groups shift via CSS transforms to make room
 */
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

  // Style matches reference implementation:
  // - When dragging, show at 50% opacity as ghost/placeholder
  // - Transform and transition handle the shifting animation
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Drag handle position depends on header row height:
  // - Single-source groups: min-h-14 (56px) → center at 28px → top-7
  // - Multi-source groups: min-h-[72px] (72px) → center at 36px → top-9
  // Using fixed offset prevents handle from moving when group expands.
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
