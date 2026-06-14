// @vitest-environment node
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";

import { createMockAuthedContext, createMockUser } from "./test-utils";

// RATE-01: prove getRaters returns rater names + stars to a user who can VIEW
// the recipe, and FORBIDS (no name leak) a user who cannot — exercised against
// the REAL assertRecipeAccess boundary (only the data layer is mocked), mirroring
// the recipes permissions-integration isolation tests.

const getRecipeRatersMock = vi.hoisted(() => vi.fn());
const getAverageRatingMock = vi.hoisted(() => vi.fn());
const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getHouseholdsForUserMock = vi.hoisted(() => vi.fn());
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());
const getConfigMock = vi.hoisted(() => vi.fn());

// Ratings data layer (the name+stars source) — mocked so no real DB/decrypt runs.
vi.mock("@norish/db/repositories/ratings", () => ({
  getRecipeRaters: getRecipeRatersMock,
  getAverageRating: getAverageRatingMock,
  getUserRatingWithVersion: vi.fn(),
  rateRecipe: vi.fn(),
}));

// withAuth middleware resolves the requester's member households (Plan 02-02/02-03)
// and OVERWRITES ctx.memberHouseholdIds from getHouseholdsForUser(user.id), so the
// per-test membership is driven through this mock (keyed by the calling user).
vi.mock("@norish/db", () => ({
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
  getHouseholdsForUser: getHouseholdsForUserMock,
  isUserServerAdmin: vi.fn(() => Promise.resolve(false)),
  getRecipeFull: vi.fn(),
}));

// resolveRecipeCookbookPolicy reads the recipe's OWN cookbook policy + admin.
vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn(),
  getHouseholdPolicy: getHouseholdPolicyMock,
}));
vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: getConfigMock,
}));
vi.mock("@norish/config/server-config-loader", () => ({
  getRecipePermissionPolicy: vi.fn(() => Promise.resolve({ view: "household" })),
}));
vi.mock("@norish/trpc/routers/ratings/emitter", () => import("../mocks/ratings-emitter"));
vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Import the REAL procedures (which call the REAL assertRecipeAccess -> REAL
// canAccessResource) AFTER the mocks are registered.
const { ratingsProcedures } = await import("@norish/trpc/routers/ratings/ratings");

function policy(p: Partial<RecipePermissionPolicy>): RecipePermissionPolicy {
  return {
    view: p.view ?? "household",
    edit: p.edit ?? "household",
    delete: p.delete ?? "household",
  };
}

const RECIPE_ID = "a1111111-1111-4111-8111-111111111111";
const COOKBOOK_A = "cookbook-a-id";
const COOKBOOK_ADMIN = "admin-in-A";
const OWNER = "owner-in-A";

describe("ratings.getRaters (real access boundary, per-cookbook)", () => {
  // Maps each test user to the cookbooks they belong to. withAuth resolves
  // ctx.memberHouseholdIds from getHouseholdsForUser(user.id), so membership is
  // controlled here rather than on the passed-in ctx (the middleware overwrites it).
  let membership: Record<string, string[]>;

  beforeEach(() => {
    vi.clearAllMocks();
    membership = {};
    getHouseholdsForUserMock.mockImplementation((userId: string) =>
      Promise.resolve((membership[userId] ?? []).map((id) => ({ id })))
    );
    // Recipe lives in cookbook A with a household view policy.
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: OWNER, householdId: COOKBOOK_A });
    getHouseholdPolicyMock.mockResolvedValue({
      policy: policy({ view: "household" }),
      adminUserId: COOKBOOK_ADMIN,
    });
    getConfigMock.mockResolvedValue(policy({ view: "everyone" }));
    getAverageRatingMock.mockResolvedValue({ averageRating: 4.5, ratingCount: 2 });
    getRecipeRatersMock.mockResolvedValue([
      { userId: OWNER, name: "Alice", rating: 5, updatedAt: new Date("2026-06-10T00:00:00Z") },
      { userId: "member-2", name: "Bob", rating: 4, updatedAt: new Date("2026-06-09T00:00:00Z") },
    ]);
  });

  function callerForMemberOf(householdIds: string[], userId = "user-U") {
    membership[userId] = householdIds;
    const ctx = {
      ...createMockAuthedContext(createMockUser({ id: userId })),
      multiplexer: null,
    };

    return ratingsProcedures.createCaller(ctx as never);
  }

  it("returns the rater names + stars + aggregate for a member who can VIEW the recipe", async () => {
    const caller = callerForMemberOf([COOKBOOK_A]);

    const result = await caller.getRaters({ recipeId: RECIPE_ID });

    expect(result.recipeId).toBe(RECIPE_ID);
    expect(result.averageRating).toBe(4.5);
    expect(result.ratingCount).toBe(2);
    expect(result.raters).toHaveLength(2);
    expect(result.raters.map((r) => r.name)).toEqual(["Alice", "Bob"]);
    expect(result.raters.map((r) => r.rating)).toEqual([5, 4]);
    expect(getRecipeRatersMock).toHaveBeenCalledWith(RECIPE_ID);
  });

  it("FORBIDS a member of only another cookbook AND never reads the raters (no cross-cookbook name leak)", async () => {
    const caller = callerForMemberOf(["cookbook-b-id"], "user-W");

    await expect(caller.getRaters({ recipeId: RECIPE_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // The access gate runs FIRST: the rater names are never fetched.
    expect(getRecipeRatersMock).not.toHaveBeenCalled();
  });

  it("FORBIDS the personal view (no membership) and never reads the raters", async () => {
    const caller = callerForMemberOf([], "user-W");

    await expect(caller.getRaters({ recipeId: RECIPE_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(getRecipeRatersMock).not.toHaveBeenCalled();
  });

  it("surfaces a null name gracefully (missing/undecryptable display name)", async () => {
    getRecipeRatersMock.mockResolvedValue([
      { userId: OWNER, name: null, rating: 3, updatedAt: new Date("2026-06-10T00:00:00Z") },
    ]);
    const caller = callerForMemberOf([COOKBOOK_A]);

    const result = await caller.getRaters({ recipeId: RECIPE_ID });

    expect(result.raters[0]?.name).toBeNull();
    expect(result.raters[0]?.rating).toBe(3);
  });

  it("throws a real TRPCError FORBIDDEN (so tRPC reports FORBIDDEN, not INTERNAL_SERVER_ERROR)", async () => {
    const caller = callerForMemberOf(["cookbook-b-id"], "user-W");

    await expect(caller.getRaters({ recipeId: RECIPE_ID })).rejects.toBeInstanceOf(TRPCError);
  });
});
