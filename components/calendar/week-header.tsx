"use client";

import { Button } from "@heroui/react";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/16/solid";
import { useFormatter } from "next-intl";

import { getWeekEnd, getWeekStart } from "@/lib/helpers";

type WeekHeaderProps = {
  weekStart: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
};

function formatWeekRange(format: ReturnType<typeof useFormatter>, weekStart: Date) {
  const start = getWeekStart(weekStart);
  const end = getWeekEnd(weekStart);

  return `${format.dateTime(start, { month: "long", day: "numeric" })} - ${format.dateTime(end, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

export function WeekHeader({ weekStart, onPrevWeek, onNextWeek, onToday }: WeekHeaderProps) {
  const format = useFormatter();
  const rangeLabel = formatWeekRange(format, weekStart);

  return (
    <div className="relative flex w-full items-center justify-center px-3 py-2 md:px-4">
      <div className="flex items-center gap-2 md:gap-3">
        <Button
          isIconOnly
          aria-label="Previous week"
          className="h-10 w-10 min-w-10"
          radius="full"
          size="sm"
          variant="flat"
          onPress={onPrevWeek}
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </Button>

        <div className="flex flex-col items-center px-2">
          <div className="text-foreground text-center text-lg font-semibold tracking-tight md:text-xl">
            {rangeLabel}
          </div>
          <div className="text-default-500 mt-0.5 text-xs font-medium md:text-sm">Week view</div>
        </div>

        <Button
          isIconOnly
          aria-label="Next week"
          className="h-10 w-10 min-w-10"
          radius="full"
          size="sm"
          variant="flat"
          onPress={onNextWeek}
        >
          <ChevronRightIcon className="h-5 w-5" />
        </Button>

        <div className="hidden md:block">
          <Button
            className="h-10 px-4"
            color="primary"
            radius="full"
            size="sm"
            variant="flat"
            onPress={onToday}
          >
            Today
          </Button>
        </div>
      </div>

      <div className="absolute right-3 md:hidden">
        <Button
          className="h-10 px-4"
          color="primary"
          radius="full"
          size="sm"
          variant="flat"
          onPress={onToday}
        >
          Today
        </Button>
      </div>
    </div>
  );
}
