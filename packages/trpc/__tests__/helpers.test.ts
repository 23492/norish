import { describe, expect, it } from "vitest";

import type { SubscriptionMultiplexer } from "@norish/queue/redis/subscription-multiplexer";
import type { RealtimeEventEnvelope } from "@norish/shared/contracts/realtime-envelope";
import { ENVELOPE_VERSION } from "@norish/shared/contracts/realtime-envelope";

import type { TypedEmitter } from "../src/emitter";
import { createEnvelopeSubscriptionIterable, createSubscriptionIterable } from "../src/helpers";

type TestPayload = { id: string };

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];

  for await (const value of iterable) {
    values.push(value);
  }

  return values;
}

function createEnvelope(payload: TestPayload): RealtimeEventEnvelope<TestPayload> {
  return {
    meta: {
      version: ENVELOPE_VERSION,
      eventId: "event-1",
      eventName: "created",
      namespace: "test",
      scope: "household",
      channel: "norish:test:household:household-1:created",
      occurredAt: "2026-06-01T00:00:00.000Z",
    },
    payload,
  };
}

function createEmitter(values: unknown[]) {
  return {
    async *createSubscription() {
      for (const value of values) {
        yield value;
      }
    },
  } as unknown as TypedEmitter<Record<string, TestPayload>>;
}

function createMultiplexer(values: unknown[]) {
  return {
    async *subscribe() {
      for (const value of values) {
        yield value;
      }
    },
  } as unknown as SubscriptionMultiplexer;
}

describe("subscription helpers", () => {
  it("unwraps realtime envelopes from direct subscriptions", async () => {
    const payload = { id: "grocery-1" };
    const iterable = createSubscriptionIterable<TestPayload>(
      createEmitter([createEnvelope(payload)]),
      null,
      "created"
    );

    await expect(collect(iterable)).resolves.toEqual([payload]);
  });

  it("unwraps realtime envelopes from multiplexed subscriptions", async () => {
    const payload = { id: "grocery-1" };
    const iterable = createSubscriptionIterable<TestPayload>(
      createEmitter([]),
      createMultiplexer([createEnvelope(payload)]),
      "created"
    );

    await expect(collect(iterable)).resolves.toEqual([payload]);
  });

  it("continues to pass through raw subscription payloads", async () => {
    const payload = { id: "grocery-1" };
    const iterable = createSubscriptionIterable<TestPayload>(
      createEmitter([payload]),
      null,
      "created"
    );

    await expect(collect(iterable)).resolves.toEqual([payload]);
  });

  it("keeps envelopes available for envelope-aware consumers", async () => {
    const envelope = createEnvelope({ id: "grocery-1" });
    const iterable = createEnvelopeSubscriptionIterable<TestPayload>(
      createEmitter([envelope]),
      null,
      "created"
    );

    await expect(collect(iterable)).resolves.toEqual([envelope]);
  });
});
