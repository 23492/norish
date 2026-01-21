"use client";

import { Skeleton } from "@heroui/react";

function DayColumnSkeleton() {
  return (
    <div className="bg-content1 flex w-full max-w-xs flex-col gap-3 rounded-xl p-4 shadow-md">
      {/* Day header */}
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-24 rounded-lg" />
        <Skeleton className="h-4 w-16 rounded-md" />
      </div>

      {/* Slots */}
      {["breakfast", "lunch", "dinner", "snack"].map((slot, i) => (
        <div key={slot} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16 rounded-md" />
          <Skeleton className="h-10 w-full rounded-lg" />
          {i < 3 && <div className="bg-divider my-2 h-px w-full" />}
        </div>
      ))}
    </div>
  );
}

export default function CalendarSkeletonDesktop() {
  return (
    <div className="flex h-full flex-col">
      {/* Week header */}
      <div className="flex items-center justify-between px-4 py-4 lg:px-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-6 w-48 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-lg" />
        </div>
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>

      {/* Week grid */}
      <div className="px-4 pb-4 lg:px-6 lg:pb-6">
        {/* Mobile: 2 columns */}
        <div className="grid grid-cols-2 gap-4 lg:hidden">
          {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => (
            <DayColumnSkeleton key={day} />
          ))}
        </div>

        {/* Desktop: 3-3-1 rows */}
        <div className="hidden flex-col gap-4 lg:flex">
          <div className="flex justify-center gap-4">
            {["mon", "tue", "wed"].map((day) => (
              <DayColumnSkeleton key={day} />
            ))}
          </div>
          <div className="flex justify-center gap-4">
            {["thu", "fri", "sat"].map((day) => (
              <DayColumnSkeleton key={day} />
            ))}
          </div>
          <div className="flex justify-center gap-4">
            <DayColumnSkeleton key="sun-single" />
          </div>
        </div>
      </div>
    </div>
  );
}
