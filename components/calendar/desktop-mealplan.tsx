"use client";

import { useState } from "react";

import { WeekGrid } from "./week-grid";
import { EditNotePanel } from "./edit-note-panel";

import MiniRecipes from "@/components/Panel/consumers/mini-recipes";
import { addWeeks, getWeekStart } from "@/lib/helpers";
import type { Slot } from "@/types";

export function DesktopMealplan() {
  const [currentWeekStart, setCurrentWeekStart] = useState(() => getWeekStart(new Date()));

  const handlePrevWeek = () => setCurrentWeekStart((prev) => addWeeks(prev, -1));
  const handleNextWeek = () => setCurrentWeekStart((prev) => addWeeks(prev, 1));
  const handleToday = () => setCurrentWeekStart(getWeekStart(new Date()));

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

  return (
    <div className="h-full">
      <WeekGrid
        weekStart={currentWeekStart}
        onPrevWeek={handlePrevWeek}
        onNextWeek={handleNextWeek}
        onToday={handleToday}
        onAddClick={handleAddClick}
        onEditNote={handleEditNote}
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
