"use client";

import { TODAY_MEAL_SLOTS } from "@/components/dashboard/todays-meals-constants";
import { Card, Skeleton } from "@heroui/react";

function TodayMealSlotSkeleton() {
  return (
    <Card className="h-[190px] w-[176px] shrink-0 overflow-hidden rounded-2xl p-0 sm:w-[190px]">
      <Skeleton className="h-[96px] w-full" />
      <Card.Content className="flex min-h-0 flex-1 flex-col justify-center gap-2 rounded-b-2xl px-3 py-2.5">
        <Skeleton className="h-4 w-4/5 rounded-md" />
        <Skeleton className="h-3 w-2/3 rounded-md" />
      </Card.Content>
    </Card>
  );
}

export default function TodaysMealsSkeleton() {
  return (
    <div className="flex gap-3">
      {TODAY_MEAL_SLOTS.map((slot) => (
        <TodayMealSlotSkeleton key={slot} />
      ))}
    </div>
  );
}
