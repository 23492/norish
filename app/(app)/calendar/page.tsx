"use client";

import { CalendarContextProvider } from "./context";

import { DesktopMealplan, DndCalendarProvider, MobileMealplan } from "@/components/calendar";

export default function CalendarPage() {
  return (
    <CalendarContextProvider>
      <DndCalendarProvider>
        <div className="block md:hidden">
          <MobileMealplan />
        </div>

        <div className="hidden h-full md:block">
          <DesktopMealplan />
        </div>
      </DndCalendarProvider>
    </CalendarContextProvider>
  );
}
