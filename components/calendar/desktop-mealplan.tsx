"use client";

import { useState, useCallback } from "react";

import { WeekGrid } from "./week-grid";
import { EditNotePanel } from "./edit-note-panel";

import MiniRecipes from "@/components/Panel/consumers/mini-recipes";
import { addWeeks, getWeekStart, getWeekEnd } from "@/lib/helpers";
import type { Slot } from "@/types";
import { useCalendarContext } from "@/app/(app)/calendar/context";
import CalendarSkeletonDesktop from "@/components/skeleton/calendar-skeleton-desktop";

export function DesktopMealplan() {
  const { dateRange, expandRange, isLoading } = useCalendarContext();
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()));

  const handlePrevWeek = useCallback(() => {
    const newWeekStart = addWeeks(currentWeekStart, -1);

    // Check if the new week is outside the loaded range
    if (newWeekStart < dateRange.start) {
      expandRange("past");
    }

    setCurrentWeekStart(newWeekStart);
  }, [currentWeekStart, dateRange.start, expandRange]);

  const handleNextWeek = useCallback(() => {
    const newWeekStart = addWeeks(currentWeekStart, 1);
    const newWeekEnd = getWeekEnd(newWeekStart);

    // Check if the new week end is outside the loaded range
    if (newWeekEnd > dateRange.end) {
      expandRange("future");
    }

    setCurrentWeekStart(newWeekStart);
  }, [currentWeekStart, dateRange.end, expandRange]);

  const handleToday = useCallback(() => {
    const todayWeekStart = getWeekStart(new Date());

    // Ensure today's week is in range
    if (todayWeekStart < dateRange.start) {
      expandRange("past");
    } else if (getWeekEnd(todayWeekStart) > dateRange.end) {
      expandRange("future");
    }

    setCurrentWeekStart(todayWeekStart);
  }, [dateRange, expandRange]);

  const [miniRecipesOpen, setMiniRecipesOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<Slot | undefined>(undefined);

  const handleAddClick = (date: Date, slot: Slot) => {
    setSelectedDate(date);
    setSelectedSlot(slot);
    setMiniRecipesOpen(true);
  };

  const [editNoteOpen, setEditNoteOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<{
    id: string;
    title: string;
    date: string;
    slot: Slot;
  } | null>(null);

  const handleEditNote = (id: string, title: string, date: string, slot: Slot) => {
    setEditingNote({ id, title, date, slot });
    setEditNoteOpen(true);
  };

  // Show full skeleton on initial load only
  if (isLoading) {
    return <CalendarSkeletonDesktop />;
  }

  return (
    <div className="h-full">
      <WeekGrid
        weekStart={currentWeekStart}
        onAddClick={handleAddClick}
        onEditNote={handleEditNote}
        onNextWeek={handleNextWeek}
        onPrevWeek={handlePrevWeek}
        onToday={handleToday}
      />

      <MiniRecipes
        date={selectedDate}
        open={miniRecipesOpen}
        slot={selectedSlot}
        onOpenChange={setMiniRecipesOpen}
      />

      {editingNote && (
        <EditNotePanel
          date={editingNote.date}
          initialTitle={editingNote.title}
          noteId={editingNote.id}
          open={editNoteOpen}
          slot={editingNote.slot}
          onOpenChange={setEditNoteOpen}
        />
      )}
    </div>
  );
}
