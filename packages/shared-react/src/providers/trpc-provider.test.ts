import { describe, expect, it, vi } from "vitest";

import { ENVELOPE_VERSION } from "@norish/shared/contracts/realtime-envelope";

import { wrapTrpcProxy } from "./trpc-provider";

describe("createTRPCProviderBundle", () => {
  it("normalizes subscription onData values to meta and payload", () => {
    const onDataInput: unknown[] = [];
    const onData = vi.fn();
    const trpc = wrapTrpcProxy(
      {
        recipes: {
          onImported: {
            subscriptionOptions: (_input: unknown, options: unknown) => options,
          },
        },
      },
      new WeakMap()
    ) as any;

    const options = trpc.recipes.onImported.subscriptionOptions(undefined, { onData }) as any;

    const envelope = {
      meta: {
        version: ENVELOPE_VERSION,
        eventId: "evt-1",
        eventName: "imported",
        namespace: "recipes",
        scope: "household",
        channel: "norish:recipes:household:hh1:imported",
        occurredAt: "2026-03-15T00:00:00.000Z",
      },
      payload: {
        recipe: { id: "r-1" },
        pendingRecipeId: "pending-1",
      },
    };

    onData.mockImplementation((value) => {
      onDataInput.push(value);
    });

    options.onData(envelope);

    expect(onData).toHaveBeenCalledOnce();
    expect(onDataInput[0]).toEqual(envelope);
  });
});
