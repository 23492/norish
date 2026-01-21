"use client";

import CalendarSkeletonDesktop from "./calendar-skeleton-desktop";
import CalendarSkeletonMobile from "./calendar-skeleton-mobile";

export default function CalendarSkeleton() {
  return (
    <>
      {/* Desktop skeleton */}
      <div className="hidden h-full md:block">
        <CalendarSkeletonDesktop />
      </div>

      {/* Mobile skeleton */}
      <div className="block md:hidden">
        <CalendarSkeletonMobile />
      </div>
    </>
  );
}
