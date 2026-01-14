"use client";

import type { GroceryGroup } from "@/lib/grocery-grouping";
import type { RecurringGroceryDto } from "@/types";

import { Checkbox } from "@heroui/react";
import { Bars3Icon, Square2StackIcon } from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";

import { formatGroupedAmount } from "@/lib/grocery-grouping";

interface GroupDragOverlayProps {
  group: GroceryGroup;
  recurringGroceries: RecurringGroceryDto[];
}

/**
 * Renders the grouped grocery item in the DragOverlay.
 * This is what the user sees following their cursor during drag.
 * Shows a visual indication that this is a group (multiple items).
 */
export function GroupDragOverlay({
  group,
  recurringGroceries: _recurringGroceries,
}: GroupDragOverlayProps) {
  const t = useTranslations("groceries.item");
  const hasMultipleSources = group.sources.length > 1;
  const aggregatedDisplay = formatGroupedAmount(group.totalAmount, group.displayUnit);

  return (
    <div
      className="bg-content1 ring-primary/20 flex items-center gap-3 rounded-lg px-4 py-3 shadow-xl ring-2"
      style={{ minHeight: hasMultipleSources ? 72 : 56 }}
    >
      {/* Drag handle visual (non-functional in overlay) */}
      <div className="text-default-400 flex h-8 w-8 items-center justify-center">
        <Bars3Icon className="h-5 w-5" />
      </div>

      {/* Checkbox visual (non-functional in overlay) */}
      <Checkbox
        isDisabled
        isIndeterminate={group.anyDone && !group.allDone}
        isSelected={group.allDone}
        radius="full"
        size="lg"
      />

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        {/* Main row: amount/unit + name */}
        <div className="flex w-full items-baseline gap-1.5">
          {aggregatedDisplay && (
            <span
              className={`shrink-0 font-medium ${
                group.allDone ? "text-default-400" : "text-primary"
              }`}
            >
              {aggregatedDisplay}
            </span>
          )}
          <span
            className={`truncate text-base ${
              group.allDone ? "text-default-400 line-through" : "text-foreground"
            }`}
          >
            {group.displayName || t("unnamedItem")}
          </span>
        </div>

        {/* Group indicator - shows number of items in group */}
        {hasMultipleSources && (
          <div className="text-default-400 mt-0.5 flex items-center gap-1 text-xs">
            <Square2StackIcon className="h-3.5 w-3.5" />
            <span>{t("items", { count: group.sources.length })}</span>
          </div>
        )}
      </div>
    </div>
  );
}
