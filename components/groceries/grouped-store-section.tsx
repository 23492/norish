"use client";

import type { GroceryDto, StoreDto, StoreColor, RecurringGroceryDto } from "@/types";
import type { GroceryGroup } from "@/lib/grocery-grouping";

import { memo, useState, useMemo } from "react";
import { motion } from "motion/react";
import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  CheckIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button } from "@heroui/react";
import { useTranslations } from "next-intl";

import { GroupedGroceryItem } from "./grouped-grocery-item";
import { DynamicHeroIcon } from "./dynamic-hero-icon";
import { getStoreColorClasses } from "./store-colors";

interface GroupedStoreSectionProps {
  store: StoreDto | null; // null = Unsorted
  groups: GroceryGroup[];
  groceries: GroceryDto[]; // Original groceries for this store (for counts)
  recurringGroceries: RecurringGroceryDto[];
  onToggle: (id: string, isDone: boolean) => void;
  onToggleGroup: (ids: string[], isDone: boolean) => void;
  onEdit: (grocery: GroceryDto) => void;
  onDelete: (id: string) => void;
  defaultExpanded?: boolean;
  onMarkAllDone?: () => void;
  onDeleteDone?: () => void;
}

/**
 * A store section that displays grouped groceries.
 * Similar to StoreSection but renders GroceryGroup objects instead of flat items.
 *
 * Note: DnD is not supported in grouped mode. Reordering must be done in normal view.
 * TODO: Implement group-aware DnD that moves all items in a group together.
 */
function GroupedStoreSectionComponent({
  store,
  groups,
  groceries,
  recurringGroceries,
  onToggle,
  onToggleGroup,
  onEdit,
  onDelete: _onDelete,
  defaultExpanded = true,
  onMarkAllDone,
  onDeleteDone,
}: GroupedStoreSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const t = useTranslations("groceries.store");

  const colorClasses = store
    ? getStoreColorClasses(store.color as StoreColor)
    : {
        bg: "bg-default-400",
        bgLight: "bg-default-100",
        text: "text-default-500",
        border: "border-default-300",
        ring: "ring-default-400",
      };

  // Calculate counts from original groceries
  const activeCount = groceries.filter((g) => !g.isDone).length;
  const doneCount = groceries.filter((g) => g.isDone).length;

  // Split groups into active and done
  const { activeGroups, doneGroups } = useMemo(() => {
    const active: GroceryGroup[] = [];
    const done: GroceryGroup[] = [];

    for (const group of groups) {
      if (group.allDone) {
        done.push(group);
      } else {
        active.push(group);
      }
    }

    return { activeGroups: active, doneGroups: done };
  }, [groups]);

  return (
    <motion.div className="relative" data-store-id={store?.id ?? "unsorted"}>
      <div className="overflow-hidden rounded-xl transition-all duration-200">
        {/* Header */}
        <div
          className={`flex w-full items-center gap-3 px-4 py-3 ${colorClasses.bgLight} rounded-t-xl`}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:opacity-90"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {/* Icon */}
            <div className={`shrink-0 rounded-full p-1.5 ${colorClasses.bg}`}>
              {store ? (
                <DynamicHeroIcon className="h-4 w-4 text-white" iconName={store.icon} />
              ) : (
                <div className="h-4 w-4" />
              )}
            </div>

            {/* Name and count */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate font-semibold">{store?.name ?? t("unsorted")}</span>
              <span className="text-default-400 shrink-0 text-sm">
                {activeCount > 0 && <span>{activeCount}</span>}
                {doneCount > 0 && (
                  <span className="text-default-300 ml-1">({t("done", { count: doneCount })})</span>
                )}
              </span>
            </div>

            {/* Expand/collapse chevron */}
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              className="text-default-400 shrink-0"
              transition={{ duration: 0.2 }}
            >
              <ChevronDownIcon className="h-5 w-5" />
            </motion.div>
          </button>

          {/* Bulk actions dropdown */}
          {groceries.length > 0 && (
            <Dropdown>
              <DropdownTrigger>
                <Button isIconOnly className="shrink-0" size="sm" variant="light">
                  <EllipsisVerticalIcon className="h-5 w-5" />
                </Button>
              </DropdownTrigger>
              <DropdownMenu aria-label={t("storeActions")}>
                <DropdownItem
                  key="mark-done"
                  startContent={<CheckIcon className="h-4 w-4" />}
                  onPress={() => onMarkAllDone?.()}
                >
                  {t("markAllDone")}
                </DropdownItem>
                <DropdownItem
                  key="delete-done"
                  className="text-danger"
                  color="danger"
                  startContent={<TrashIcon className="h-4 w-4" />}
                  onPress={() => onDeleteDone?.()}
                >
                  {t("deleteDone")}
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
          )}
        </div>

        {/* Groups content */}
        {isExpanded && (
          <div className="divide-default-100 divide-y">
            {/* Active groups */}
            {activeGroups.map((group, index) => {
              const isFirst = index === 0;
              const isLast = index === activeGroups.length - 1 && doneGroups.length === 0;

              return (
                <GroupedGroceryItem
                  key={group.groupKey}
                  group={group}
                  isFirst={isFirst}
                  isLast={isLast}
                  recurringGroceries={recurringGroceries}
                  onEdit={onEdit}
                  onToggle={onToggle}
                  onToggleGroup={onToggleGroup}
                />
              );
            })}

            {/* Done groups */}
            {doneGroups.map((group, index) => {
              const isFirst = index === 0 && activeGroups.length === 0;
              const isLast = index === doneGroups.length - 1;

              return (
                <GroupedGroceryItem
                  key={group.groupKey}
                  group={group}
                  isFirst={isFirst}
                  isLast={isLast}
                  recurringGroceries={recurringGroceries}
                  onEdit={onEdit}
                  onToggle={onToggle}
                  onToggleGroup={onToggleGroup}
                />
              );
            })}

            {/* Empty state */}
            {activeGroups.length === 0 && doneGroups.length === 0 && (
              <div className="text-default-400 px-4 py-6 text-center text-sm">{t("noItems")}</div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const GroupedStoreSection = memo(GroupedStoreSectionComponent);
