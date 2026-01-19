"use client";

import { PlusIcon } from "@heroicons/react/16/solid";
import { Dropdown, DropdownTrigger, Button, DropdownMenu, DropdownItem } from "@heroui/react";
import { useMemo, useRef, useCallback, memo, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocale, useTranslations } from "next-intl";

import { Slot } from "@/types";
import DayTimelineSkeleton from "@/components/skeleton/day-timeline-skeleton";
import { startOfMonth, addMonths, endOfMonth, eachDayOfInterval, dateKey } from "@/lib/helpers";
import { useRecipeQuery } from "@/hooks/recipes";
import { MealIcon } from "@/lib/meal-icon";
import Panel from "@/components/Panel/Panel";
import { useCalendarQuery, useCalendarMutations, useCalendarSubscription } from "@/hooks/calendar";

const ESTIMATED_DAY_HEIGHT = 140; // Approximate height of a day row

type MiniCalendarProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipeId: string;
};

// Memoized day row to prevent re-renders when other days change
const DayRow = memo(function DayRow({
  date,
  dateKeyStr,
  isToday,
  items,
  weekdayLong,
  monthLong,
  onPlan,
  slotLabels,
  noItemsLabel,
  addItemLabel,
}: {
  date: Date;
  dateKeyStr: string;
  isToday: boolean;
  items: { slot: Slot; itemType: string; recipeName?: string | null; title?: string | null }[];
  weekdayLong: Intl.DateTimeFormat;
  monthLong: Intl.DateTimeFormat;
  onPlan: (dayKey: string, slot: Slot) => void;
  slotLabels: Record<Slot, string>;
  noItemsLabel: string;
  addItemLabel: string;
}) {
  return (
    <div className="border-default-100 border-b last:border-none">
      <div className="bg-background hover:bg-default-50/50 flex flex-col gap-3 px-4 py-4 transition-colors">
        <div className="flex items-center gap-4">
          <div className="bg-default-50 flex shrink-0 flex-col items-center justify-center rounded-xl px-3 py-2 text-center">
            <div className="text-default-500 text-xs font-medium tracking-wider uppercase">
              {weekdayLong.format(date).slice(0, 3)}
            </div>
            <div
              className={`${
                isToday ? "text-primary" : "text-foreground"
              } font-mono text-2xl leading-none font-bold tracking-tight`}
            >
              {String(date.getDate())}
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-center">
            <div className="text-default-900 text-sm font-semibold">{weekdayLong.format(date)}</div>
            <div className="text-default-500 text-xs">
              {monthLong.format(date)} {date.getFullYear()}
            </div>
          </div>

          <Dropdown>
            <DropdownTrigger>
              <Button
                isIconOnly
                aria-label={addItemLabel}
                className="bg-default-100 text-default-500 hover:text-primary h-8 min-w-8 rounded-full shadow-sm transition-transform active:scale-95"
                size="sm"
                variant="flat"
              >
                <PlusIcon className="h-4 w-4" />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Choose slot"
              onAction={(slot) => onPlan(dateKeyStr, slot as Slot)}
            >
              <DropdownItem key="Breakfast">{slotLabels.Breakfast}</DropdownItem>
              <DropdownItem key="Lunch">{slotLabels.Lunch}</DropdownItem>
              <DropdownItem key="Dinner">{slotLabels.Dinner}</DropdownItem>
              <DropdownItem key="Snack">{slotLabels.Snack}</DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>

        <div className="flex w-full flex-col gap-2 pl-[4.5rem]">
          {items.length === 0 ? (
            <span className="text-default-400 text-xs italic">{noItemsLabel}</span>
          ) : (
            items.map((it, i) => (
              <div
                key={i}
                className="bg-content1 border-default-100 flex w-full items-center gap-3 rounded-lg border px-3 py-2 shadow-sm"
              >
                <MealIcon slot={it.slot} />
                <span
                  className={`truncate text-sm font-medium ${it.itemType === "note" ? "text-default-500 italic" : "text-foreground"}`}
                  title={it.itemType === "recipe" ? (it.recipeName ?? "") : (it.title ?? "")}
                >
                  {it.itemType === "recipe" ? it.recipeName : it.title}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
});

function MiniCalendarContent({
  recipeId,
  onOpenChange,
}: {
  recipeId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("calendar.panel");
  const tSlots = useTranslations("common.slots");
  const tTimeline = useTranslations("calendar.timeline");
  const locale = useLocale();
  const today = useMemo(() => new Date(), []);
  const rangeStart = useMemo(() => startOfMonth(addMonths(today, -1)), [today]);
  const rangeEnd = useMemo(() => endOfMonth(addMonths(today, 1)), [today]);

  const startISO = dateKey(rangeStart);
  const endISO = dateKey(rangeEnd);

  const { recipe } = useRecipeQuery(recipeId);
  const { calendarData, isLoading } = useCalendarQuery(startISO, endISO);
  const { createItem } = useCalendarMutations(startISO, endISO);

  useCalendarSubscription(startISO, endISO);

  const allDays = useMemo(() => eachDayOfInterval(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  const weekdayLong = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: "long" }), [locale]);
  const monthLong = useMemo(() => new Intl.DateTimeFormat(locale, { month: "long" }), [locale]);
  const todayKey = useMemo(() => dateKey(today), [today]);
  const todayIndex = useMemo(
    () => allDays.findIndex((d) => dateKey(d) === todayKey),
    [allDays, todayKey]
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToToday, setHasScrolledToToday] = useState(false);

  // Calculate initial offset to start at today
  const initialOffset = todayIndex >= 0 ? todayIndex * ESTIMATED_DAY_HEIGHT : 0;

  const virtualizer = useVirtualizer({
    count: allDays.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_DAY_HEIGHT,
    overscan: 3,
    getItemKey: (index) => dateKey(allDays[index]),
    initialOffset,
  });

  // Scroll to today after first render
  useEffect(() => {
    if (hasScrolledToToday || todayIndex < 0 || !parentRef.current) return;

    const timeoutId = setTimeout(() => {
      virtualizer.scrollToIndex(todayIndex, { align: "start" });
      setHasScrolledToToday(true);
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [todayIndex, hasScrolledToToday, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();

  const slotOrder: Record<Slot, number> = { Breakfast: 0, Lunch: 1, Dinner: 2, Snack: 3 };

  const slotLabels: Record<Slot, string> = useMemo(
    () => ({
      Breakfast: tSlots("breakfast"),
      Lunch: tSlots("lunch"),
      Dinner: tSlots("dinner"),
      Snack: tSlots("snack"),
    }),
    [tSlots]
  );

  const noItemsLabel = tTimeline("noItems");
  const addItemLabel = tTimeline("addItem");

  const handlePlan = useCallback(
    (dayKey: string, slot: Slot) => {
      if (!recipe) return;

      createItem(dayKey, slot, "recipe", recipe.id, undefined);
      onOpenChange(false);
    },
    [recipe, onOpenChange, createItem]
  );

  if (isLoading) {
    return <DayTimelineSkeleton />;
  }

  if (allDays.length === 0) {
    return (
      <div className="text-default-500 flex items-center justify-center p-4 text-sm">
        {t("noDaysAvailable")}
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={parentRef} className="absolute inset-0 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualItems.map((virtualItem) => {
            const d = allDays[virtualItem.index];
            const key = dateKey(d);
            const items = (calendarData[key] ?? []).sort(
              (a, b) => slotOrder[a.slot] - slotOrder[b.slot]
            );
            const isToday = key === todayKey;

            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <DayRow
                  addItemLabel={addItemLabel}
                  date={d}
                  dateKeyStr={key}
                  isToday={isToday}
                  items={items}
                  monthLong={monthLong}
                  noItemsLabel={noItemsLabel}
                  slotLabels={slotLabels}
                  weekdayLong={weekdayLong}
                  onPlan={handlePlan}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MiniCalendar({ open, onOpenChange, recipeId }: MiniCalendarProps) {
  const t = useTranslations("calendar.panel");

  return (
    <Panel open={open} title={t("addToCalendar")} onOpenChange={onOpenChange}>
      <div className="flex min-h-0 flex-1 flex-col">
        {open && <MiniCalendarContent recipeId={recipeId} onOpenChange={onOpenChange} />}
      </div>
    </Panel>
  );
}
