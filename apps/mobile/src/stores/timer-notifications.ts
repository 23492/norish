import * as Notifications from "expo-notifications";

import { createClientLogger } from "@norish/shared/lib/logger";

const logger = createClientLogger("timer-notifications");

// ─── Foreground handler ──────────────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Show / dismiss ──────────────────────────────────────────────────────────

export async function showTimerNotification(timer: {
  id: string;
  label: string;
  recipeName?: string;
}): Promise<void> {
  try {
    const title = timer.recipeName ? `${timer.label} — ${timer.recipeName}` : timer.label;

    await Notifications.scheduleNotificationAsync({
      // Phase 27 W4 (D-27-W4-07, mobile half): a per-timer, addressable
      // identifier — additive, so two concurrently completing NAMED timers
      // (the pasta+sauce case) each raise their OWN notification. Expo does
      // NOT collapse same-category notifications the way the web
      // Notification API collapses same-`tag` ones, so this is not a repeat
      // of the web bug fix — it is a new addressability guarantee.
      // `categoryIdentifier` below is expo's action-CATEGORY (the button
      // set), not a dedupe key — left exactly as it was, never repurposed.
      identifier: timer.id,
      content: {
        title,
        body: "Timer complete!",
        sound: "default",
        categoryIdentifier: "timer-complete",
      },
      trigger: null,
    });
  } catch (err) {
    logger.warn(err, "Failed to show timer notification");
  }
}

export async function dismissAllTimerNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch (err) {
    logger.warn(err, "Failed to dismiss notifications");
  }
}

// ─── Permissions ─────────────────────────────────────────────────────────────

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();

  if (existingStatus === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}
