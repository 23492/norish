import { describe, expect, it } from "vitest";

import { dateKey } from "@norish/shared/lib/helpers";

import { filterVisibleDays } from "@/components/calendar/visible-days";

// Phase 21: the calendar timeline hides empty past days but never touches today
// or the future, and keeps past days that actually have planned items.
describe("filterVisibleDays", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00`);
  const days = [day("2026-07-20"), day("2026-07-21"), day("2026-07-22"), day("2026-07-23")];
  const todayKey = dateKey(day("2026-07-22"));

  it("drops past days with no items", () => {
    const visible = filterVisibleDays(days, {}, todayKey);

    expect(visible.map(dateKey)).toEqual(["2026-07-22", "2026-07-23"]);
  });

  it("keeps past days that hold at least one item", () => {
    const visible = filterVisibleDays(days, { [dateKey(day("2026-07-20"))]: [{}] }, todayKey);

    expect(visible.map(dateKey)).toEqual(["2026-07-20", "2026-07-22", "2026-07-23"]);
  });

  it("always keeps today and every future day, even when empty", () => {
    const future = [day("2026-07-22"), day("2026-07-25"), day("2026-08-01")];
    const visible = filterVisibleDays(future, {}, todayKey);

    expect(visible).toHaveLength(3);
  });

  it("treats an empty array entry as no items (still dropped)", () => {
    const visible = filterVisibleDays(days, { [dateKey(day("2026-07-21"))]: [] }, todayKey);

    expect(visible.map(dateKey)).toEqual(["2026-07-22", "2026-07-23"]);
  });
});
