/**
 * Outbox Reconciliation Helpers
 *
 * Minimal client-side utilities for matching incoming realtime event envelopes
 * against queued offline actions via operationId.
 *
 * These helpers are designed to be consumed by future outbox/offline sync
 * implementations without requiring broad changes to subscription handlers.
 */

import type {
  NormalizedSubscriptionData,
  OperationId,
  RealtimeEventMeta,
} from "@norish/shared/contracts/realtime-envelope";
import { extractMeta, normalizeSubscriptionData } from "@norish/shared/lib/operation-helpers";

/**
 * Check if an incoming event matches a queued offline action.
 *
 * @param data - Incoming subscription data (raw or enveloped)
 * @param queuedOperationId - The operationId of a queued offline action
 * @returns `true` if the event was caused by the specified queued action
 *
 * @example
 * ```ts
 * useSubscription(trpc.recipes.onImported.subscriptionOptions(undefined, {
 *   onData: (data) => {
 *     if (isFromQueuedAction(data, pendingAction.operationId)) {
 *       removePendingAction(pendingAction.id);
 *     }
 *   },
 * }));
 * ```
 */
export function isFromQueuedAction(data: unknown, queuedOperationId: OperationId): boolean {
  const meta = extractMeta(data);

  return meta?.operationId === queuedOperationId;
}

/**
 * Normalize incoming subscription data and extract the operationId (if present).
 *
 * This is the primary edge helper all subscription hooks can use to:
 * 1. Get the payload for cache updates (unchanged from before)
 * 2. Get the operationId for outbox reconciliation (new)
 *
 * @example
 * ```ts
 * onData: (rawData: unknown) => {
 *   const { meta, payload } = normalizeForOutbox(rawData);
 *   // payload is the same domain object as before
 *   updateRecipeInCache(payload);
 *   // meta?.operationId can be used for outbox matching
 *   if (meta?.operationId) {
 *     clearQueuedAction(meta.operationId);
 *   }
 * }
 * ```
 */
export function normalizeForOutbox<T = unknown>(
  data: unknown
): NormalizedSubscriptionData<T> {
  return normalizeSubscriptionData<T>(data);
}

/**
 * Extract just the operationId from incoming subscription data.
 * Returns `undefined` if the data is not enveloped or has no operationId.
 */
export function getEventOperationId(data: unknown): OperationId | undefined {
  const meta: RealtimeEventMeta | null = extractMeta(data);

  return meta?.operationId;
}
