// @vitest-environment node
/**
 * Phase 22 / REALTIME-ISO-01 — realtime fan-out isolation.
 *
 * These tests reproduced the LIVE cross-cookbook leak before any production change
 * (plan 22-01) and now pin it closed (plan 22-02). They drive the REAL `emitByPolicy`
 * and the REAL scope resolvers; only the DB reads underneath are mocked.
 *
 * The server-wide policy is held at the LIVE production value `view: "everyone"`
 * throughout — success criterion 1 requires the leak to be closed with that config
 * in place, since the fix must be in code and not a config flip.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  broadcastChannels,
  deliveredTo,
  HOUSEHOLD_A,
  LIVE_SERVER_POLICY,
  RECIPE_IN_A,
  RecordingEmitter,
  USER_A,
  USER_B,
} from "./fan-out-harness";

const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());
const getRecipePermissionPolicyMock = vi.hoisted(() => vi.fn());

vi.mock("@norish/db/repositories/recipes", () => ({
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
}));

vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdPolicy: getHouseholdPolicyMock,
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getRecipePermissionPolicy: getRecipePermissionPolicyMock,
}));

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

const { emitByPolicy, resolveHouseholdRealtimeScope, resolveRecipeRealtimeScope } =
  await import("@norish/shared-server/realtime/policy");

type RecipeEvents = Record<string, unknown>;

/** The recipe-bearing events an outsider must never receive (22-AUDIT). */
const RECIPE_EVENTS = [
  "importStarted",
  "importProgress",
  "imported",
  "updated",
  "created",
  "converted",
] as const;

const DTO_PAYLOAD = { recipe: { id: RECIPE_IN_A, name: "Cookbook A secret" } };

/** A second member of cookbook A who does NOT own the recipe. */
const OTHER_MEMBER_OF_A = { userId: "user-a2", householdKey: HOUSEHOLD_A };

/** Cookbook A: a normal household cookbook. Phase 3 forbids a per-cookbook `everyone`. */
function cookbookAIsHousehold(): void {
  getRecipeOwnerAndHouseholdMock.mockResolvedValue({
    userId: USER_A.userId,
    householdId: HOUSEHOLD_A,
  });
  getHouseholdPolicyMock.mockResolvedValue({
    policy: { view: "household", edit: "household", delete: "household" },
    adminUserId: USER_A.userId,
  });
}

describe("realtime fan-out isolation (two cookbooks, two subscribers)", () => {
  let recorder: RecordingEmitter<RecipeEvents>;

  beforeEach(() => {
    vi.clearAllMocks();
    recorder = new RecordingEmitter<RecipeEvents>("recipe");
    // The live server-wide default stays `everyone` for every test in this file.
    getRecipePermissionPolicyMock.mockResolvedValue(LIVE_SERVER_POLICY);
    cookbookAIsHousehold();
  });

  describe.each(RECIPE_EVENTS)("event: %s", (event) => {
    beforeEach(async () => {
      const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(RECIPE_IN_A, {
        userId: USER_A.userId,
        householdKey: HOUSEHOLD_A,
      });

      emitByPolicy(recorder, viewPolicy, ctx, event, DTO_PAYLOAD);
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

  it("does not reach every connected socket even when the cookbook policy is `everyone`", () => {
    // D-22-01 in isolation: `everyone` must not broadcast, whatever produced it.
    emitByPolicy(
      recorder,
      "everyone",
      { userId: USER_A.userId, householdKey: HOUSEHOLD_A },
      "imported",
      DTO_PAYLOAD
    );

    expect(recorder.channels()).not.toContain("norish:recipe:broadcast:imported");
    expect(deliveredTo(recorder, USER_B, "imported")).toEqual([]);
    expect(deliveredTo(recorder, USER_A, "imported")).toEqual([
      "norish:recipe:household:hh-a:imported",
    ]);
  });
});

describe("resolveRecipeRealtimeScope (D-22-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecipePermissionPolicyMock.mockResolvedValue(LIVE_SERVER_POLICY);
  });

  it("keys on the RECIPE's cookbook, not the actor's active cookbook", async () => {
    cookbookAIsHousehold();

    // The actor is working from cookbook B (e.g. rating a recipe shared from A).
    const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(RECIPE_IN_A, {
      userId: USER_B.userId,
      householdKey: USER_B.householdKey,
    });

    expect(ctx.householdKey).toBe(HOUSEHOLD_A);
    expect(ctx.userId).toBe(USER_A.userId);
    expect(viewPolicy).toBe("household");
  });

  it("does not leak an actor-keyed emission to the actor's own cookbook", async () => {
    cookbookAIsHousehold();

    const recorder = new RecordingEmitter<RecipeEvents>("recipe");
    const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(RECIPE_IN_A, {
      userId: USER_B.userId,
      householdKey: USER_B.householdKey,
    });

    emitByPolicy(recorder, viewPolicy, ctx, "updated", DTO_PAYLOAD);

    expect(deliveredTo(recorder, USER_B, "updated")).toEqual([]);
    expect(deliveredTo(recorder, USER_A, "updated").length).toBeGreaterThan(0);
  });

  it("honours a cookbook's OWN narrower policy over the wider server default", async () => {
    // Cookbook A is `view: "owner"` while the server default is `everyone`. Resolving from
    // the server default instead of the cookbook would widen this to the whole cookbook.
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({
      userId: USER_A.userId,
      householdId: HOUSEHOLD_A,
    });
    getHouseholdPolicyMock.mockResolvedValue({
      policy: { view: "owner", edit: "owner", delete: "owner" },
      adminUserId: USER_A.userId,
    });

    const recorder = new RecordingEmitter<RecipeEvents>("recipe");
    const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(RECIPE_IN_A, {
      userId: USER_A.userId,
      householdKey: HOUSEHOLD_A,
    });

    expect(viewPolicy).toBe("owner");
    emitByPolicy(recorder, viewPolicy, ctx, "updated", DTO_PAYLOAD);

    // Only the owner's user channel — not cookbook A's household channel, so a fellow
    // member of A (who is not the owner) receives nothing.
    expect(recorder.channels()).toEqual(["norish:recipe:user:user-a:updated"]);
    expect(deliveredTo(recorder, OTHER_MEMBER_OF_A, "updated")).toEqual([]);
  });

  it("routes a personal recipe to its owner only, never to a household channel", async () => {
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({
      userId: USER_A.userId,
      householdId: null,
    });

    const recorder = new RecordingEmitter<RecipeEvents>("recipe");
    const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(RECIPE_IN_A, {
      userId: USER_A.userId,
      householdKey: HOUSEHOLD_A,
    });

    // The server default is `everyone`; a personal recipe must still reach only its owner.
    expect(viewPolicy).toBe("everyone");
    emitByPolicy(recorder, viewPolicy, ctx, "imported", DTO_PAYLOAD);

    expect(recorder.channels()).toEqual(["norish:recipe:user:user-a:imported"]);
    expect(deliveredTo(recorder, USER_B, "imported")).toEqual([]);
  });

  it("fails closed to the actor when the recipe cannot be resolved", async () => {
    getRecipeOwnerAndHouseholdMock.mockResolvedValue(null);

    const recorder = new RecordingEmitter<RecipeEvents>("recipe");
    const fallback = { userId: USER_B.userId, householdKey: USER_B.householdKey };
    const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(RECIPE_IN_A, fallback);

    expect(viewPolicy).toBe("owner");
    expect(ctx).toEqual(fallback);

    emitByPolicy(recorder, viewPolicy, ctx, "deleted", { id: RECIPE_IN_A });
    // `owner` scope: the actor's user channel only — never a household or broadcast channel.
    expect(recorder.channels()).toEqual(["norish:recipe:user:user-b:deleted"]);
    expect(broadcastChannels(recorder)).toEqual([]);
  });

  it("keeps the recipe's own household as the key when that household is gone", async () => {
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({
      userId: USER_A.userId,
      householdId: HOUSEHOLD_A,
    });
    getHouseholdPolicyMock.mockResolvedValue(null);

    const { ctx } = await resolveRecipeRealtimeScope(RECIPE_IN_A, {
      userId: USER_B.userId,
      householdKey: USER_B.householdKey,
    });

    expect(ctx.householdKey).toBe(HOUSEHOLD_A);
  });
});

describe("resolveHouseholdRealtimeScope (pre-row import events)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRecipePermissionPolicyMock.mockResolvedValue(LIVE_SERVER_POLICY);
  });

  it("scopes importStarted to the TARGET cookbook, never broadcast", async () => {
    getHouseholdPolicyMock.mockResolvedValue({
      policy: { view: "household", edit: "household", delete: "household" },
      adminUserId: USER_A.userId,
    });

    const recorder = new RecordingEmitter<RecipeEvents>("recipe");
    const { viewPolicy, ctx } = await resolveHouseholdRealtimeScope(HOUSEHOLD_A, {
      userId: USER_A.userId,
      householdKey: HOUSEHOLD_A,
    });

    emitByPolicy(recorder, viewPolicy, ctx, "importStarted", { recipeId: RECIPE_IN_A });

    expect(deliveredTo(recorder, USER_B, "importStarted")).toEqual([]);
    expect(deliveredTo(recorder, USER_A, "importStarted").length).toBeGreaterThan(0);
    expect(broadcastChannels(recorder)).toEqual([]);
  });

  it("scopes a personal import to the importer alone", async () => {
    const recorder = new RecordingEmitter<RecipeEvents>("recipe");
    const { viewPolicy, ctx } = await resolveHouseholdRealtimeScope(null, {
      userId: USER_A.userId,
      householdKey: USER_A.userId,
    });

    emitByPolicy(recorder, viewPolicy, ctx, "importStarted", { recipeId: RECIPE_IN_A });

    expect(recorder.channels()).toEqual(["norish:recipe:user:user-a:importStarted"]);
  });
});
