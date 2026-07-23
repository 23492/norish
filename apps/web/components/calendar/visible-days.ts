import { dateKey } from "@norish/shared/lib/helpers";

/**
 * Hides empty past days from the calendar timeline (Phase 21 polish).
 *
 * Today and every future day always render (so the timeline never has a hole
 * around "now" and planning ahead is unaffected). A day strictly before today
 * is kept only when it holds at least one planned item — so the scroll-up
 * history collapses to the days that actually have something on them.
 *
 * `dateKey` yields `YYYY-MM-DD`, so a lexical comparison is chronological.
 */
export function filterVisibleDays<T>(
  days: Date[],
  itemsByDate: Record<string, T[] | undefined>,
  todayKey: string
): Date[] {
  return days.filter((day) => {
    const key = dateKey(day);

    if (key >= todayKey) {
      return true;
    }

    return (itemsByDate[key]?.length ?? 0) > 0;
  });
}
