/**
 * Tests for outbox reconciliation helpers.
 */
import { describe, expect, it } from "vitest";

import type { RealtimeEventEnvelope } from "@norish/shared/contracts/realtime-envelope";
import { ENVELOPE_VERSION } from "@norish/shared/contracts/realtime-envelope";
import { generateOperationId } from "@norish/shared/lib/operation-helpers";
import {
  getEventOperationId,
  isFromQueuedAction,
  normalizeForOutbox,
} from "./outbox-helpers";

function makeEnvelope(
  operationId?: ReturnType<typeof generateOperationId>
): RealtimeEventEnvelope<{ recipeId: string }> {
  return {
    meta: {
      version: ENVELOPE_VERSION,
      eventId: "evt-1",
      eventName: "imported",
      namespace: "recipes",
      scope: "household",
      channel: "norish:recipes:household:hh1:imported",
      occurredAt: "2024-01-01T00:00:00Z",
      ...(operationId ? { operationId } : {}),
    },
    payload: { recipeId: "r-1" },
  };
}

describe("isFromQueuedAction", () => {
  it("returns true when operationId matches", () => {
    const opId = generateOperationId();
    const envelope = makeEnvelope(opId);

    expect(isFromQueuedAction(envelope, opId)).toBe(true);
  });

  it("returns false when operationId does not match", () => {
    const opId1 = generateOperationId();
    const opId2 = generateOperationId();
    const envelope = makeEnvelope(opId1);

    expect(isFromQueuedAction(envelope, opId2)).toBe(false);
  });

  it("returns false for envelopes without operationId", () => {
    const envelope = makeEnvelope();

    expect(isFromQueuedAction(envelope, generateOperationId())).toBe(false);
  });

  it("returns false for raw payloads", () => {
    const raw = { recipeId: "r-1" };

    expect(isFromQueuedAction(raw, generateOperationId())).toBe(false);
  });
});

describe("normalizeForOutbox", () => {
  it("normalizes enveloped data with meta", () => {
    const opId = generateOperationId();
    const envelope = makeEnvelope(opId);

    const result = normalizeForOutbox<{ recipeId: string }>(envelope);

    expect(result.meta?.operationId).toBe(opId);
    expect(result.payload.recipeId).toBe("r-1");
  });

  it("normalizes raw data with null meta", () => {
    const raw = { recipeId: "r-1" };
    const result = normalizeForOutbox<{ recipeId: string }>(raw);

    expect(result.meta).toBeNull();
    expect(result.payload.recipeId).toBe("r-1");
  });
});

describe("getEventOperationId", () => {
  it("returns operationId from enveloped data", () => {
    const opId = generateOperationId();
    const envelope = makeEnvelope(opId);

    expect(getEventOperationId(envelope)).toBe(opId);
  });

  it("returns undefined for envelopes without operationId", () => {
    const envelope = makeEnvelope();

    expect(getEventOperationId(envelope)).toBeUndefined();
  });

  it("returns undefined for raw payloads", () => {
    expect(getEventOperationId({ recipeId: "r-1" })).toBeUndefined();
  });
});

describe("existing payload consumers work without changes", () => {
  it("normalizeForOutbox payload is identical to original payload", () => {
    const originalPayload = {
      recipeId: "r-1",
      recipe: { id: "r-1", name: "Test Recipe", tags: ["dinner"] },
    };
    const envelope: RealtimeEventEnvelope = {
      meta: {
        version: ENVELOPE_VERSION,
        eventId: "evt-1",
        eventName: "imported",
        namespace: "recipes",
        scope: "household",
        channel: "norish:recipes:household:hh1:imported",
        occurredAt: "2024-01-01T00:00:00Z",
      },
      payload: originalPayload,
    };

    const result = normalizeForOutbox(envelope);

    // The payload should be the exact same object (no cloning/mutation)
    expect(result.payload).toBe(originalPayload);
  });
});
