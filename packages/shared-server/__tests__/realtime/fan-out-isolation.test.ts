// @vitest-environment node
/**
 * Phase 22 / REALTIME-ISO-01 — realtime fan-out isolation.
 *
 * These tests reproduce the LIVE cross-cookbook leak before any production change
 * (plan 22-01). They drive the REAL `emitByPolicy` with the exact arguments production
 * feeds it today, as tabulated in `.planning/phases/22-realtime-fan-out-isolation/22-AUDIT.md`:
 * viewPolicy = the server-wide `getRecipePermissionPolicy().view` (live value `"everyone"`),
 * ctx = the ACTOR's context.
 *
 * Expected state at 22-01: RED.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  broadcastChannels,
  deliveredTo,
  HOUSEHOLD_A,
  LIVE_SERVER_POLICY,
  RecordingEmitter,
  USER_A,
  USER_B,
} from "./fan-out-harness";

vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  redisLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
}));

const { emitByPolicy } = await import("@norish/shared-server/realtime/policy");

type RecipeEvents = Record<string, unknown>;

/** The recipe-bearing events an outsider must never receive (22-AUDIT). */
const RECIPE_EVENTS = ["importStarted", "imported", "updated", "created", "converted"] as const;

/** The actor's emit context, exactly as the workers/routers build it today. */
const ACTOR_CTX = { userId: USER_A.userId, householdKey: HOUSEHOLD_A };

describe("realtime fan-out isolation (two cookbooks, two subscribers)", () => {
  let recorder: RecordingEmitter<RecipeEvents>;

  beforeEach(() => {
    recorder = new RecordingEmitter<RecipeEvents>("recipe");
  });

  describe.each(RECIPE_EVENTS)("event: %s", (event) => {
    beforeEach(() => {
      // Reproduces production: the server-wide policy is the viewPolicy argument.
      emitByPolicy(recorder, LIVE_SERVER_POLICY.view, ACTOR_CTX, event, {
        recipe: { id: "recipe-in-a", name: "Cookbook A secret" },
      });
    });

    it("is never delivered to a member of another cookbook", () => {
      expect(deliveredTo(recorder, USER_B, event)).toEqual([]);
    });

    it("is still delivered to a member of the recipe's own cookbook", () => {
      expect(deliveredTo(recorder, USER_A, event).length).toBeGreaterThan(0);
    });

    it("never lands on a broadcast channel (D-22-01)", () => {
      expect(broadcastChannels(recorder)).toEqual([]);
    });
  });

  it("does not reach every connected socket under the live server policy", () => {
    // The single assertion that names the defect: with the live
    // `recipe_permission_policy.view = "everyone"`, a full recipe DTO is published to a
    // channel every authenticated connection subscribes to.
    emitByPolicy(recorder, LIVE_SERVER_POLICY.view, ACTOR_CTX, "imported", {
      recipe: { id: "recipe-in-a", name: "Cookbook A secret" },
    });

    expect(recorder.channels()).not.toContain("norish:recipe:broadcast:imported");
  });
});

describe("resolveRecipeRealtimeScope (D-22-02)", () => {
  it("resolves the view policy and target key from the recipe's OWN cookbook", async () => {
    const policyModule = (await import("@norish/shared-server/realtime/policy")) as Record<
      string,
      unknown
    >;

    // The resolver is what makes the ACTOR-keyed leak vector (22-AUDIT vector 2)
    // impossible: both the policy and the household key must come from the recipe.
    expect(typeof policyModule.resolveRecipeRealtimeScope).toBe("function");
  });
});
