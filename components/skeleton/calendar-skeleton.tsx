"use client";

export default function CalendarSkeleton() {
  return (
    <>
      {/* Desktop skeleton */}
      <div className="hidden h-full md:block">
        <h1>Skeleton</h1>
      </div>

      {/* Mobile skeleton */}
      <div className="block md:hidden">
        <h1>skeleton</h1>
      </div>
    </>
  );
}
