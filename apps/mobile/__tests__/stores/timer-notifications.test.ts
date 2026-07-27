// Phase 27 (COOK-01) W4, T4 — the mobile half of D-27-W4-07.
//
// Mobile never had a colliding `tag` the way the web Notification API did
// (T3 fixed that collapse on web). This is an ADDITIVE addressability fix:
// a top-level `identifier: timer.id` on `scheduleNotificationAsync`, so a
// specific timer's notification is later addressable — e.g. by two
// concurrently completing NAMED timers (the pasta+sauce case). Do NOT read
// this as "mobile had the web bug" — it did not; expo does not collapse
// same-`categoryIdentifier` notifications.
//
// `categoryIdentifier: "timer-complete"` (expo's action-CATEGORY, not a
// dedupe key) must survive UNCHANGED — this suite proves it does.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { showTimerNotification } from "../../src/stores/timer-notifications";

type ScheduleArg = {
  identifier?: string;
  content: { categoryIdentifier?: string };
};

const scheduleNotificationAsync = vi.fn((_arg: ScheduleArg) => Promise.resolve("scheduled-id"));

vi.mock("expo-notifications", () => ({
  setNotificationHandler: vi.fn(),
  scheduleNotificationAsync: (arg: ScheduleArg) => scheduleNotificationAsync(arg),
  dismissAllNotificationsAsync: () => Promise.resolve(),
  getPermissionsAsync: () => Promise.resolve({ status: "granted" }),
  requestPermissionsAsync: () => Promise.resolve({ status: "granted" }),
}));

vi.mock("@norish/shared/lib/logger", () => ({
  createClientLogger: () => ({ warn: vi.fn() }),
}));

describe("showTimerNotification (Phase 27 W4, T4, D-27-W4-07)", () => {
  beforeEach(() => {
    scheduleNotificationAsync.mockClear();
  });

  it("passes a top-level `identifier: timer.id` so the notification is addressable", async () => {
    await showTimerNotification({ id: "recipe-1-s0-0", label: "pasta" });

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(scheduleNotificationAsync.mock.calls[0]![0].identifier).toBe("recipe-1-s0-0");
  });

  it('leaves `categoryIdentifier: "timer-complete"` exactly as it was — never repurposed as the dedupe key', async () => {
    await showTimerNotification({ id: "recipe-1-s0-1", label: "sauce" });

    expect(scheduleNotificationAsync.mock.calls[0]![0].content.categoryIdentifier).toBe(
      "timer-complete"
    );
  });

  it("gives two concurrently completing NAMED timers (pasta+sauce) DISTINCT identifiers", async () => {
    await showTimerNotification({ id: "recipe-1-s0-0", label: "pasta" });
    await showTimerNotification({ id: "recipe-1-s0-1", label: "sauce" });

    expect(scheduleNotificationAsync).toHaveBeenCalledTimes(2);

    const firstIdentifier = scheduleNotificationAsync.mock.calls[0]![0].identifier;
    const secondIdentifier = scheduleNotificationAsync.mock.calls[1]![0].identifier;

    expect(firstIdentifier).toBe("recipe-1-s0-0");
    expect(secondIdentifier).toBe("recipe-1-s0-1");
    expect(firstIdentifier).not.toBe(secondIdentifier);
  });
});
