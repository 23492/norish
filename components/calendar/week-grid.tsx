"use client";

import { DayColumn } from "./day-column";
import { WeekHeader } from "./week-header";

import { dateKey, getWeekDays } from "@/lib/helpers";
import type { Slot } from "@/types";

export type WeekGridProps = {
  weekStart: Date;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onAddClick: (date: Date, slot: Slot) => void;
  onEditNote: (id: string, title: string, date: string, slot: Slot) => void;
};

export function WeekGrid({
  weekStart,
  onPrevWeek,
  onNextWeek,
  onToday,
  onAddClick,
  onEditNote,
}: WeekGridProps) {
  const days = getWeekDays(weekStart);
  const todayStr = dateKey(new Date());

  const firstRow = days.slice(0, 3);
  const secondRow = days.slice(3, 6);
  const thirdRow = days.slice(6);

  const renderDayColumn = (day: Date) => {
    const key = dateKey(day);
    const isToday = key === todayStr;

    return (
      <DayColumn
        key={key}
        date={day}
        dateKey={key}
        isToday={isToday}
        onAddClick={(slot) => onAddClick(day, slot)}
        onEditNote={onEditNote}
      />
    );
  };

  return (
    <div className="flex h-full flex-col">
      <WeekHeader
        weekStart={weekStart}
        onPrevWeek={onPrevWeek}
        onNextWeek={onNextWeek}
        onToday={onToday}
      />

      <div className="px-4 pb-4 lg:px-6 lg:pb-6">
        <div className="grid grid-cols-2 gap-4 lg:hidden">{days.map(renderDayColumn)}</div>

        <div className="hidden flex-col gap-4 lg:flex">
          <div className="flex justify-center gap-4">{firstRow.map(renderDayColumn)}</div>
          <div className="flex justify-center gap-4">{secondRow.map(renderDayColumn)}</div>
          <div className="flex justify-center gap-4">{thirdRow.map(renderDayColumn)}</div>
        </div>
      </div>
    </div>
  );
}
