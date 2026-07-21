/**
 * Two-household / two-subscriber realtime fan-out harness (Phase 22, REALTIME-ISO-01).
 *
 * Models BOTH sides of the realtime bus without Redis, so an isolation assertion is
 * deterministic and runs in the normal unit suite:
 *
 * - PUBLISH side: `RecordingEmitter` implements the exact surface `emitByPolicy` uses
 *   (`broadcast` / `emitToHousehold` / `emitToUser`) and derives every channel name from a
 *   REAL `TypedRedisEmitter`, so the harness cannot drift from production channel shapes.
 * - RECEIVE side: `subscriberChannels()` returns the same household + broadcast + user
 *   triple that `createPolicyAwareIterables` subscribes each connection to
 *   (`packages/trpc/src/helpers.ts:204-206`). That broadcast subscription is why
 *   `emitter.broadcast()` means "every connected client".
 *
 * Delivery to a given subscriber is therefore exactly the intersection of the two sets.
 */

import { TypedRedisEmitter } from "@norish/shared-server/redis/pubsub";

export interface RecordedEmit {
  channel: string;
  event: string;
  data: unknown;
}

/**
 * A TypedRedisEmitter stand-in that records publishes instead of hitting Redis.
 * Channel names come from a real emitter instance — never hand-written literals.
 */
export class RecordingEmitter<TEvents extends Record<string, unknown>> {
  readonly recorded: RecordedEmit[] = [];

  private readonly real: TypedRedisEmitter<TEvents>;

  constructor(readonly namespace: string) {
    this.real = new TypedRedisEmitter<TEvents>(namespace);
  }

  broadcast<K extends keyof TEvents & string>(event: K, data: TEvents[K]): Promise<boolean> {
    return this.record(this.real.broadcastEvent(event), event, data);
  }

  emitToHousehold<K extends keyof TEvents & string>(
    householdKey: string,
    event: K,
    data: TEvents[K]
  ): Promise<boolean> {
    return this.record(this.real.householdEvent(householdKey, event), event, data);
  }

  emitToUser<K extends keyof TEvents & string>(
    userId: string,
    event: K,
    data: TEvents[K]
  ): Promise<boolean> {
    return this.record(this.real.userEvent(userId, event), event, data);
  }

  emitGlobal<K extends keyof TEvents & string>(event: K, data: TEvents[K]): Promise<boolean> {
    return this.record(this.real.globalEvent(event), event, data);
  }

  broadcastEvent<K extends keyof TEvents & string>(event: K): string {
    return this.real.broadcastEvent(event);
  }

  householdEvent<K extends keyof TEvents & string>(householdKey: string, event: K): string {
    return this.real.householdEvent(householdKey, event);
  }

  userEvent<K extends keyof TEvents & string>(userId: string, event: K): string {
    return this.real.userEvent(userId, event);
  }

  globalEvent<K extends keyof TEvents & string>(event: K): string {
    return this.real.globalEvent(event);
  }

  channels(): string[] {
    return this.recorded.map((r) => r.channel);
  }

  reset(): void {
    this.recorded.length = 0;
  }

  private record(channel: string, event: string, data: unknown): Promise<boolean> {
    this.recorded.push({ channel, event, data });

    return Promise.resolve(true);
  }
}

/** A connected client, as the tRPC middleware describes one (middleware.ts:38). */
export interface Subscriber {
  userId: string;
  /** `household?.id ?? user.id` — the active cookbook, or the user id when personal. */
  householdKey: string;
}

/**
 * The three channels a connection subscribes to for one event, mirroring
 * `createPolicyAwareIterables` (packages/trpc/src/helpers.ts:204-206):
 * household, broadcast, user.
 */
export function subscriberChannels(
  namespace: string,
  subscriber: Subscriber,
  event: string
): string[] {
  const emitter = new TypedRedisEmitter<Record<string, unknown>>(namespace);

  return [
    emitter.householdEvent(subscriber.householdKey, event),
    emitter.broadcastEvent(event),
    emitter.userEvent(subscriber.userId, event),
  ];
}

/** The channels this subscriber would actually receive, for the given event. */
export function deliveredTo<TEvents extends Record<string, unknown>>(
  recorder: RecordingEmitter<TEvents>,
  subscriber: Subscriber,
  event: string
): string[] {
  const subscribed = new Set(subscriberChannels(recorder.namespace, subscriber, event));

  return recorder.channels().filter((c) => subscribed.has(c));
}

/** Every recorded channel that is a broadcast channel (D-22-01: there must be none). */
export function broadcastChannels<TEvents extends Record<string, unknown>>(
  recorder: RecordingEmitter<TEvents>
): string[] {
  return recorder.channels().filter((c) => c.includes(":broadcast:"));
}

/* ---------------------------------------------------------------- fixtures */

export const HOUSEHOLD_A = "hh-a";
export const HOUSEHOLD_B = "hh-b";

/** Member of cookbook A; owns the recipe under test. */
export const USER_A: Subscriber = { userId: "user-a", householdKey: HOUSEHOLD_A };
/** Member of cookbook B. Must never receive anything about A's recipe. */
export const USER_B: Subscriber = { userId: "user-b", householdKey: HOUSEHOLD_B };

export const RECIPE_IN_A = "recipe-in-a";

/** The policy live in production on 2026-07-21 — the reason the leak is active. */
export const LIVE_SERVER_POLICY = {
  view: "everyone",
  edit: "household",
  delete: "household",
} as const;
