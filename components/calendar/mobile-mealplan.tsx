"use client";

import { useRef, useEffect, useState, useMemo } from "react";

import { MealplanCard } from "./mealplan-card";
import { ScrollToTodayButton } from "./scroll-to-today-button";
import { EditNotePanel } from "./edit-note-panel";

import { dateKey, eachDayOfInterval, startOfMonth, endOfMonth, addMonths } from "@/lib/helpers";
import MiniRecipes from "@/components/Panel/consumers/mini-recipes";
import { Slot } from "@/types";

export function MobileMealplan() {
  const containerRef = useRef<HTMLDivElement>(null);

  const [miniRecipesOpen, setMiniRecipesOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedSlot, setSelectedSlot] = useState<Slot | undefined>(undefined);

  const [editNoteOpen, setEditNoteOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<{
    id: string;
    title: string;
    date: string;
    slot: Slot;
  } | null>(null);

  const days = useMemo(() => {
    const now = new Date();
    const start = startOfMonth(addMonths(now, -1));
    const end = endOfMonth(addMonths(now, 1));

    return eachDayOfInterval(start, end);
  }, []);

  const todayKey = dateKey(new Date());

  const scrollToToday = () => {
    const el = document.getElementById(`day-${todayKey}`);

    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useEffect(() => {
    const el = document.getElementById(`day-${todayKey}`);

    if (el) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isTodayVisible, setIsTodayVisible] = useState(true);
  const [todayDirection, setTodayDirection] = useState<"up" | "down">("up");

  useEffect(() => {
    const el = document.getElementById(`day-${todayKey}`);

    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsTodayVisible(entry.isIntersecting);
        if (!entry.isIntersecting) {
          const rect = entry.boundingClientRect;

          setTodayDirection(rect.top < 0 ? "up" : "down");
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, [todayKey]);

  const handleAddClick = (date: Date, slot: Slot) => {
    setSelectedDate(date);
    setSelectedSlot(slot);
    setMiniRecipesOpen(true);
  };

  const handleEditNote = (id: string, title: string, date: string, slot: Slot) => {
    setEditingNote({ id, title, date, slot });
    setEditNoteOpen(true);
  };

  return (
    <>
      <div ref={containerRef} className="w-full pb-20">
        <div className="flex min-h-full flex-col gap-4 px-2 py-4">
          {days.map((day) => {
            const dKey = dateKey(day);
            const isToday = dKey === todayKey;

            return (
              <div key={dKey} id={`day-${dKey}`}>
                <MealplanCard
                  date={day}
                  isToday={isToday}
                  onAddClick={(slot) => handleAddClick(day, slot)}
                  onEditNote={handleEditNote}
                />
              </div>
            );
          })}
        </div>
      </div>

      <ScrollToTodayButton
        direction={todayDirection}
        visible={!isTodayVisible}
        onClick={scrollToToday}
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
    </>
  );
}
