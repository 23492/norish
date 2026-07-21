// @vitest-environment node
/**
 * Phase 22 / REALTIME-ISO-01 — router-level realtime fan-out isolation.
 *
 * The shared-server suite proves the primitives in isolation. This suite proves the
 * ROUTER-SHAPED composition: the real `resolveRecipeRealtimeScope` + the real
 * `emitByPolicy`, driven exactly as the tRPC routers drive them — with an actor whose
 * ACTIVE cookbook is not the recipe's cookbook, which is the case the old actor-keyed
 * emissions got wrong (22-AUDIT vector 2).
 *
 * Only the DB reads underneath the resolver are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  broadcastChannels,
  deliveredTo,
  HOUSEHOLD_A,
  LIVE_SERVER_POLICY,
  RECIPE_IN_A,
  RecordingEmitter,
  subscriberChannels,
  USER_A,
  USER_B,
} from "../../../shared-server/__tests__/realtime/fan-out-harness";

const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());
const getRecipePermissionPolicyMock = vi.hoisted(() => vi.fn());

// The hoisted pnpm linker gives each package its own @norish/db copy, so mocking the
// bare specifier from here would target packages/trpc's copy while the resolver (loaded
// from node_modules/@norish/shared-server) imports the root one. Mock the root copy by
// absolute path so the identities match.
vi.mock("../../../../node_modules/@norish/db/src/repositories/recipes.ts", () => ({
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
}));

vi.mock("../../../../node_modules/@norish/db/src/repositories/households.ts", () => ({
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

// The REAL re-exports the routers import from (`../../helpers`).
const { emitByPolicy, resolveRecipeRealtimeScope } = await import("../../src/helpers");

type Events = Record<string, unknown>;

/**
 * The tRPC context of a member of cookbook B — `householdKey = household?.id ?? user.id`
 * (packages/trpc/src/middleware.ts:38). This actor is rating / updating a recipe that
 * lives in cookbook A.
 */
const ACTOR_IN_B = { userId: USER_B.userId, householdKey: USER_B.householdKey };

/** The exact two-line shape every migrated router site now uses. */
async function emitAsRouterDoes(
  recorder: RecordingEmitter<Events>,
  recipeId: string,
  event: string,
  data: unknown
): Promise<void> {
  const { viewPolicy, ctx } = await resolveRecipeRealtimeScope(recipeId, ACTOR_IN_B);

  emitByPolicy(recorder as never, viewPolicy, ctx, event, data as never);
}

describe("router realtime emissions never cross a cookbook boundary", () => {
  let recorder: RecordingEmitter<Events>;

  beforeEach(() => {
    vi.clearAllMocks();
    recorder = new RecordingEmitter<Events>("recipe");
    getRecipePermissionPolicyMock.mockResolvedValue(LIVE_SERVER_POLICY);
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({
      userId: USER_A.userId,
      householdId: HOUSEHOLD_A,
    });
    getHouseholdPolicyMock.mockResolvedValue({
      policy: { view: "household", edit: "household", delete: "household" },
      adminUserId: USER_A.userId,
    });
  });

  it.each([
    ["recipes.update", "updated", { recipe: { id: RECIPE_IN_A } }],
    ["recipes.updateCategories", "updated", { recipe: { id: RECIPE_IN_A } }],
    ["recipes.convert", "converted", { recipe: { id: RECIPE_IN_A } }],
    ["ratings.rate", "ratingUpdated", { recipeId: RECIPE_IN_A, averageRating: 4 }],
    ["shares.setVisibility", "updated", { recipe: { id: RECIPE_IN_A } }],
  ])("%s: reaches the recipe's cookbook, not the actor's", async (_site, event, payload) => {
    await emitAsRouterDoes(recorder, RECIPE_IN_A, event, payload);

    // The actor is in cookbook B; the event must NOT follow them there.
    expect(deliveredTo(recorder, USER_B, event)).toEqual([]);
    // It must reach cookbook A, which owns the recipe.
    expect(deliveredTo(recorder, USER_A, event)).toEqual([
      `norish:recipe:household:${HOUSEHOLD_A}:${event}`,
    ]);
    expect(broadcastChannels(recorder)).toEqual([]);
  });

  it("emits a deletion to the recipe's cookbook when resolved before the row is removed", async () => {
    await emitAsRouterDoes(recorder, RECIPE_IN_A, "deleted", { id: RECIPE_IN_A });

    expect(deliveredTo(recorder, USER_A, "deleted").length).toBeGreaterThan(0);
    expect(deliveredTo(recorder, USER_B, "deleted")).toEqual([]);
  });

  it("falls back to the actor alone once the recipe is gone", async () => {
    // What the delete path would do if the scope were resolved AFTER deletion: the
    // resolver fails closed to the actor rather than widening.
    getRecipeOwnerAndHouseholdMock.mockResolvedValue(null);

    await emitAsRouterDoes(recorder, RECIPE_IN_A, "deleted", { id: RECIPE_IN_A });

    expect(recorder.channels()).toEqual([`norish:recipe:user:${USER_B.userId}:deleted`]);
    expect(deliveredTo(recorder, USER_A, "deleted")).toEqual([]);
  });

  it("keeps failure events private to the actor (owner scope)", async () => {
    // `emitRecipeFailure` / `emitRatingFailed` are pinned to "owner" — a failed action
    // concerns only whoever attempted it, and must not tell a cookbook about it.
    emitByPolicy(
      recorder as never,
      "owner",
      ACTOR_IN_B,
      "failed" as never,
      {
        reason: "boom",
      } as never
    );

    expect(recorder.channels()).toEqual([`norish:recipe:user:${USER_B.userId}:failed`]);
    expect(broadcastChannels(recorder)).toEqual([]);
  });
});

describe("the receive side is unchanged — isolation lives on the SEND side", () => {
  it("still subscribes every connection to the broadcast channel", () => {
    // createPolicyAwareIterables (packages/trpc/src/helpers.ts:204-206) is deliberately
    // NOT changed by Phase 22. It still subscribes household + broadcast + user, which is
    // why nothing resource-bearing may ever be published to the broadcast channel.
    expect(subscriberChannels("recipe", USER_B, "imported")).toContain(
      "norish:recipe:broadcast:imported"
    );
  });
});
