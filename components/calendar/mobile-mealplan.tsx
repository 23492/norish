"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";

import { MealplanCard } from "./mealplan-card";
import { ScrollToTodayButton } from "./scroll-to-today-button";
import { EditNotePanel } from "./edit-note-panel";

import { dateKey, eachDayOfInterval } from "@/lib/helpers";
import MiniRecipes from "@/components/Panel/consumers/mini-recipes";
import { Slot } from "@/types";
import { useCalendarContext } from "@/app/(app)/calendar/context";
import CalendarSkeletonMobile, {
  MealplanCardSkeleton,
} from "@/components/skeleton/calendar-skeleton-mobile";

export function MobileMealplan() {
  const containerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const scrollRestorationRef = useRef<{ key: string; scrollTop: number } | null>(null);

  const { dateRange, expandRange, isLoading, isLoadingMore } = useCalendarContext();

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

  // Generate days from the context's date range
  const days = useMemo(() => {
    return eachDayOfInterval(dateRange.start, dateRange.end);
  }, [dateRange.start, dateRange.end]);

  const todayKey = dateKey(new Date());

  const scrollToToday = useCallback(() => {
    const el = document.getElementById(`day-${todayKey}`);

    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [todayKey]);

  // Track if we've done the initial scroll
  const hasScrolledToTodayRef = useRef(false);

  // Scroll to today after initial load completes
  useEffect(() => {
    // Only scroll once, after loading completes
    if (isLoading || hasScrolledToTodayRef.current) return;

    const el = document.getElementById(`day-${todayKey}`);

    if (el) {
      el.scrollIntoView({ behavior: "instant", block: "start" });
      hasScrolledToTodayRef.current = true;
    }
  }, [isLoading, todayKey]);

  const [isTodayVisible, setIsTodayVisible] = useState(true);
  const [todayDirection, setTodayDirection] = useState<"up" | "down">("up");

  // Track today's visibility for scroll-to-today button
  useEffect(() => {
    // Don't set up observer while loading (element doesn't exist yet)
    if (isLoading) return;

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
  }, [todayKey, isLoading]);

  // Get the first day key for scroll restoration
  const firstDayKey = days[0] ? dateKey(days[0]) : null;

  // Intersection observer for infinite scroll
  useEffect(() => {
    const topEl = topSentinelRef.current;
    const bottomEl = bottomSentinelRef.current;

    if (!topEl || !bottomEl) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          if (entry.target === topEl) {
            // Save scroll position before expanding past
            if (containerRef.current && firstDayKey) {
              scrollRestorationRef.current = {
                key: firstDayKey,
                scrollTop: containerRef.current.scrollTop,
              };
            }
            expandRange("past");
          } else if (entry.target === bottomEl) {
            expandRange("future");
          }
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );

    observer.observe(topEl);
    observer.observe(bottomEl);

    return () => observer.disconnect();
  }, [expandRange, firstDayKey]);

  // Restore scroll position after prepending past dates
  useEffect(() => {
    if (!scrollRestorationRef.current || !containerRef.current) return;

    const { key } = scrollRestorationRef.current;
    const el = document.getElementById(`day-${key}`);

    if (el) {
      // Restore scroll to keep the same day visible
      el.scrollIntoView({ behavior: "instant", block: "start" });
      scrollRestorationRef.current = null;
    }
  }); // Runs on every render to check for scroll restoration

  const handleAddClick = (date: Date, slot: Slot) => {
    setSelectedDate(date);
    setSelectedSlot(slot);
    setMiniRecipesOpen(true);
  };

  const handleEditNote = (id: string, title: string, date: string, slot: Slot) => {
    setEditingNote({ id, title, date, slot });
    setEditNoteOpen(true);
  };

  // Show full skeleton on initial load
  if (isLoading) {
    return <CalendarSkeletonMobile />;
  }

  return (
    <>
      <div ref={containerRef} className="w-full pb-20">
        <div className="flex min-h-full flex-col gap-4 px-2 py-4">
          {/* Top sentinel for loading past dates */}
          <div ref={topSentinelRef} className="h-1" />

          {/* Loading skeleton at top when loading past */}
          {isLoadingMore && <MealplanCardSkeleton />}

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

          {/* Loading skeleton at bottom when loading future */}
          {isLoadingMore && <MealplanCardSkeleton />}

          {/* Bottom sentinel for loading future dates */}
          <div ref={bottomSentinelRef} className="h-1" />
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
