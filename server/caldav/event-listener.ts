import type { CalendarSubscriptionEvents } from "@/server/trpc/routers/calendar/types";
import type { RecipeSubscriptionEvents } from "@/server/trpc/routers/recipes/types";
import type { Slot } from "@/types";

import { getQueues } from "@/server/queue/registry";
import { addCaldavSyncJob } from "@/server/queue/caldav-sync/producer";
import { calendarEmitter } from "@/server/trpc/routers/calendar/emitter";
import { recipeEmitter } from "@/server/trpc/routers/recipes/emitter";
import { getCaldavSyncStatusByItemId } from "@/server/db/repositories/caldav-sync-status";
import { getCaldavConfigDecrypted } from "@/server/db/repositories/caldav-config";
import { createLogger } from "@/server/logger";

const log = createLogger("caldav-sync");

let isInitialized = false;
let abortController: AbortController | null = null;

export function initCaldavSync(): void {
  if (isInitialized) {
    log.warn("CalDAV sync service already initialized");

    return;
  }

  log.info("Initializing CalDAV sync service");

  abortController = new AbortController();
  const signal = abortController.signal;

  // Start background subscription loops
  startCalendarSubscriptions(signal);
  startRecipeSubscriptions(signal);

  isInitialized = true;
  log.info("CalDAV sync service initialized");
}

export function stopCaldavSync(): void {
  if (!isInitialized || !abortController) {
    return;
  }

  log.info("Stopping CalDAV sync service");
  abortController.abort();
  abortController = null;
  isInitialized = false;
}

async function getCaldavServerUrl(userId: string): Promise<string | null> {
  const config = await getCaldavConfigDecrypted(userId);

  if (!config || !config.enabled) return null;

  return config.serverUrl;
}

async function queueSyncJob(
  userId: string,
  itemId: string,
  itemType: "recipe" | "note",
  plannedItemId: string,
  eventTitle: string,
  date: string,
  slot: Slot,
  recipeId?: string
): Promise<void> {
  const caldavServerUrl = await getCaldavServerUrl(userId);

  if (!caldavServerUrl) {
    log.debug({ userId, itemId }, "CalDAV not configured, skipping sync");

    return;
  }

  await addCaldavSyncJob(getQueues().caldavSync, {
    userId,
    itemId,
    itemType,
    plannedItemId,
    eventTitle,
    date,
    slot,
    recipeId,
    operation: "sync",
    caldavServerUrl,
  });
}

async function queueDeleteJob(userId: string, itemId: string): Promise<void> {
  const caldavServerUrl = await getCaldavServerUrl(userId);

  if (!caldavServerUrl) {
    log.debug({ userId, itemId }, "CalDAV not configured, skipping delete");

    return;
  }

  await addCaldavSyncJob(getQueues().caldavSync, {
    userId,
    itemId,
    itemType: "recipe", // Doesn't matter for delete
    plannedItemId: null,
    eventTitle: "",
    date: "",
    slot: "",
    operation: "delete",
    caldavServerUrl,
  });
}

async function startCalendarSubscriptions(signal: AbortSignal): Promise<void> {
  // Run all subscriptions concurrently
  await Promise.all([
    subscribeToGlobalEvent(
      "globalRecipePlanned",
      signal,
      async (data: CalendarSubscriptionEvents["globalRecipePlanned"]) => {
        const { id, recipeId, recipeName, date, slot, userId } = data;

        log.debug({ id, recipeId, userId }, "Recipe planned - queuing CalDAV sync");
        try {
          await queueSyncJob(userId, id, "recipe", id, recipeName, date, slot, recipeId);
        } catch (error) {
          log.error({ err: error, id, userId }, "Failed to queue CalDAV sync for planned recipe");
        }
      }
    ),
    subscribeToGlobalEvent(
      "globalRecipeDeleted",
      signal,
      async (data: CalendarSubscriptionEvents["globalRecipeDeleted"]) => {
        const { id, userId } = data;

        log.debug({ id, userId }, "Recipe unplanned - queuing CalDAV delete");
        try {
          await queueDeleteJob(userId, id);
        } catch (error) {
          log.error(
            { err: error, id, userId },
            "Failed to queue CalDAV delete for unplanned recipe"
          );
        }
      }
    ),
    subscribeToGlobalEvent(
      "globalRecipeUpdated",
      signal,
      async (data: CalendarSubscriptionEvents["globalRecipeUpdated"]) => {
        const { id, recipeId, recipeName, newDate, slot, userId } = data;

        log.debug({ id, userId, newDate }, "Recipe updated - queuing CalDAV sync");
        try {
          const syncStatus = await getCaldavSyncStatusByItemId(userId, id);

          if (!syncStatus) {
            log.debug({ id, userId }, "Recipe not synced to CalDAV, skipping update");

            return;
          }
          await queueSyncJob(userId, id, "recipe", id, recipeName, newDate, slot, recipeId);
        } catch (error) {
          log.error({ err: error, id, userId }, "Failed to queue CalDAV sync for recipe update");
        }
      }
    ),
    subscribeToGlobalEvent(
      "globalNotePlanned",
      signal,
      async (data: CalendarSubscriptionEvents["globalNotePlanned"]) => {
        const { id, title, date, slot, userId } = data;

        log.debug({ id, title, userId }, "Note planned - queuing CalDAV sync");
        try {
          await queueSyncJob(userId, id, "note", id, title, date, slot);
        } catch (error) {
          log.error({ err: error, id, userId }, "Failed to queue CalDAV sync for planned note");
        }
      }
    ),
    subscribeToGlobalEvent(
      "globalNoteDeleted",
      signal,
      async (data: CalendarSubscriptionEvents["globalNoteDeleted"]) => {
        const { id, userId } = data;

        log.debug({ id, userId }, "Note unplanned - queuing CalDAV delete");
        try {
          await queueDeleteJob(userId, id);
        } catch (error) {
          log.error({ err: error, id, userId }, "Failed to queue CalDAV delete for unplanned note");
        }
      }
    ),
    subscribeToGlobalEvent(
      "globalNoteUpdated",
      signal,
      async (data: CalendarSubscriptionEvents["globalNoteUpdated"]) => {
        const { id, title, newDate, slot, userId } = data;

        log.debug({ id, userId, newDate }, "Note updated - queuing CalDAV sync");
        try {
          const syncStatus = await getCaldavSyncStatusByItemId(userId, id);

          if (!syncStatus) {
            log.debug({ id, userId }, "Note not synced to CalDAV, skipping update");

            return;
          }
          await queueSyncJob(userId, id, "note", id, title, newDate, slot);
        } catch (error) {
          log.error({ err: error, id, userId }, "Failed to queue CalDAV sync for note update");
        }
      }
    ),
  ]);
}

async function subscribeToGlobalEvent<K extends keyof CalendarSubscriptionEvents>(
  event: K,
  signal: AbortSignal,
  handler: (data: CalendarSubscriptionEvents[K]) => Promise<void>
): Promise<void> {
  const channel = calendarEmitter.globalEvent(event);

  try {
    for await (const data of calendarEmitter.createSubscription(channel, signal)) {
      await handler(data as CalendarSubscriptionEvents[K]);
    }
  } catch (err) {
    if (!signal.aborted) {
      log.error({ err, event }, "Calendar subscription error");
    }
  }
}

async function startRecipeSubscriptions(signal: AbortSignal): Promise<void> {
  const channel = recipeEmitter.broadcastEvent("updated");

  try {
    for await (const data of recipeEmitter.createSubscription(channel, signal)) {
      const typedData = data as RecipeSubscriptionEvents["updated"];
      const { recipe } = typedData;

      if (!recipe || !recipe.name) continue;

      const recipeId = recipe.id;
      const newName = recipe.name;

      log.debug(
        { recipeId, newName },
        "Recipe name updated - CalDAV sync temporarily disabled during planned_items migration"
      );

      // TODO: Re-enable after planned-items repository is implemented
      // This requires getPlannedItemsByRecipeId from the new repository
    }
  } catch (err) {
    if (!signal.aborted) {
      log.error({ err }, "Recipe subscription error");
    }
  }
}

export async function syncAllFutureItems(userId: string): Promise<{
  totalSynced: number;
  totalFailed: number;
}> {
  log.info({ userId }, "syncAllFutureItems temporarily disabled during planned_items migration");

  // TODO: Re-enable after planned-items repository is implemented
  return { totalSynced: 0, totalFailed: 0 };
}

/**
 * Retry pending/failed syncs for a user.
 * Used by the tRPC procedures for manual retry.
 */
export async function retryFailedSyncs(userId: string): Promise<{
  totalRetried: number;
  totalFailed: number;
}> {
  log.info({ userId }, "retryFailedSyncs temporarily disabled during planned_items migration");

  // TODO: Re-enable after planned-items repository is implemented
  return { totalRetried: 0, totalFailed: 0 };
}
