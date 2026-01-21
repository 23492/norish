"use client";

import { Skeleton } from "@heroui/react";

function MealplanCardSkeleton() {
  return (
    <div className="px-0.5 pt-1 pb-2">
      <div className="bg-content1 w-full rounded-xl p-4 shadow-md">
        {/* Day header */}
        <div className="flex flex-col gap-1 pb-3">
          <Skeleton className="h-7 w-28 rounded-lg" />
          <Skeleton className="h-4 w-20 rounded-md" />
        </div>

        {/* Slots */}
        {["breakfast", "lunch", "dinner", "snack"].map((slot, i) => (
          <div key={slot} className="py-3">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-16 rounded-md" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
            {i < 3 && <div className="bg-divider mt-4 h-px w-full" />}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CalendarSkeletonMobile() {
  return (
    <div className="w-full pb-20">
      <div className="flex min-h-full flex-col gap-4 px-2 py-4">
        {/* Render skeleton cards for visible days */}
        {["day-1", "day-2", "day-3", "day-4", "day-5"].map((dayId) => (
          <MealplanCardSkeleton key={dayId} />
        ))}
      </div>
    </div>
  );
}

export { MealplanCardSkeleton };
