"use client";

import { CalendarContextProvider } from "./context";

import { DndCalendarProvider, MobileMealplan } from "@/components/calendar";

export default function CalendarPage() {
  return (
    <CalendarContextProvider>
      <DndCalendarProvider>
        <MobileMealplan />
      </DndCalendarProvider>
    </CalendarContextProvider>
  );
}
