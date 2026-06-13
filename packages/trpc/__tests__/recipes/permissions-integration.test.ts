// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";

import { createMockFullRecipe, createMockHousehold, createMockUser } from "./test-utils";

// Hoisted mocks for the dependencies of the REAL permission path
// (assertRecipeAccess -> canAccessResource).
const getRecipeFullMock = vi.hoisted(() => vi.fn());
const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getConfigMock = vi.hoisted(() => vi.fn());

// The permission boundary itself is NOT mocked here — we exercise the real
// canAccessResource (via assertRecipeAccess / findRecipeForViewer) so the
// per-cookbook isolation (HOUSE-06) is genuinely tested end-to-end.
vi.mock("@norish/db", () => ({
  getRecipeFull: getRecipeFullMock,
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
}));

// canAccessResource reads the policy via getConfig from @norish/db/repositories/server-config.
vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: getConfigMock,
}));

// helpers.ts imports getRecipePermissionPolicy from the config loader (used only on the
// failure-emit path); stub it so the module graph resolves.
vi.mock("@norish/config/server-config-loader", () => ({
  getRecipePermissionPolicy: vi.fn(() => Promise.resolve({ view: "household" })),
}));

vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@norish/trpc/routers/recipes/emitter", () => ({
  recipeEmitter: { emit: vi.fn(), emitToHousehold: vi.fn(), emitToUser: vi.fn() },
}));

vi.mock("../../src/helpers", () => ({
  emitByPolicy: vi.fn(),
}));

// Import the REAL helpers (which call the REAL canAccessResource) after the mocks.
const { assertRecipeAccess, findRecipeForViewer } = await import(
  "../../src/routers/recipes/helpers"
);

function setPolicy(policy: Partial<RecipePermissionPolicy>): void {
  getConfigMock.mockResolvedValue({
    view: policy.view ?? "everyone",
    edit: policy.edit ?? "household",
    delete: policy.delete ?? "household",
  });
}

describe("recipe permission enforcement (real boundary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("owner / admin / everyone", () => {
    it("owner can always view their own recipe regardless of policy", async () => {
      setPolicy({ view: "owner" });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "owner-id", householdId: null })
      );

      const ctx = {
        user: { id: "owner-id" },
        memberHouseholdIds: [],
        isServerAdmin: false,
      };

      const recipe = await findRecipeForViewer(ctx, "r1");

      expect(recipe).not.toBeNull();
    });

    it("server admin can view any recipe", async () => {
      setPolicy({ view: "owner" });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "someone-else", householdId: "cookbook-x" })
      );

      const ctx = {
        user: { id: "admin-id" },
        memberHouseholdIds: [],
        isServerAdmin: true,
      };

      const recipe = await findRecipeForViewer(ctx, "r1");

      expect(recipe).not.toBeNull();
    });

    it("everyone policy lets any user view any recipe", async () => {
      setPolicy({ view: "everyone" });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "owner-id", householdId: "cookbook-a" })
      );

      const ctx = {
        user: { id: "stranger" },
        memberHouseholdIds: [],
        isServerAdmin: false,
      };

      const recipe = await findRecipeForViewer(ctx, "r1");

      expect(recipe).not.toBeNull();
    });

    it("owner policy hides a recipe from a non-owner", async () => {
      setPolicy({ view: "owner" });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "owner-id", householdId: "cookbook-a" })
      );

      const ctx = {
        user: { id: "stranger" },
        memberHouseholdIds: ["cookbook-a"],
        isServerAdmin: false,
      };

      const recipe = await findRecipeForViewer(ctx, "r1");

      expect(recipe).toBeNull();
    });
  });

  describe("household policy — member of the recipe's cookbook", () => {
    it("a member of the recipe's cookbook can view it", async () => {
      const household = createMockHousehold();

      setPolicy({ view: "household" });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "owner-id", householdId: household.id })
      );

      const ctx = {
        user: { id: "member-id" },
        memberHouseholdIds: [household.id],
        isServerAdmin: false,
      };

      const recipe = await findRecipeForViewer(ctx, "r1");

      expect(recipe).not.toBeNull();
    });
  });

  // ----------------------------------------------------------------------------
  // SECURITY-CRITICAL (HOUSE-06): a member of cookbook B can never view/edit/delete
  // a recipe that lives in cookbook A, regardless of the active selection.
  // ----------------------------------------------------------------------------
  describe("cross-cookbook isolation (household policy)", () => {
    const cookbookA = "cookbook-a-id";
    const cookbookB = "cookbook-b-id";
    const recipeId = "recipe-in-A";
    const owner = "owner-in-A";

    // Requester U is a member of cookbook A only.
    const ctxMemberOfA = {
      user: { id: "user-U" },
      memberHouseholdIds: [cookbookA],
      isServerAdmin: false,
    };

    // Requester W is a member of cookbook B only — must NOT reach A's recipe.
    const ctxMemberOfB = {
      user: { id: "user-W" },
      memberHouseholdIds: [cookbookB],
      isServerAdmin: false,
    };

    // Personal view (no active household); still only A's members may reach A.
    const ctxPersonal = {
      user: { id: "user-W" },
      memberHouseholdIds: [],
      isServerAdmin: false,
    };

    beforeEach(() => {
      setPolicy({ view: "household", edit: "household", delete: "household" });
      // The recipe lives in cookbook A, owned by `owner`.
      getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: owner, householdId: cookbookA });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: recipeId, userId: owner, householdId: cookbookA })
      );
    });

    it.each(["view", "edit", "delete"] as const)(
      "FORBIDS a member of only cookbook B from %s on cookbook A's recipe",
      async (action) => {
        await expect(assertRecipeAccess(ctxMemberOfB, recipeId, action)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    );

    it.each(["view", "edit", "delete"] as const)(
      "ALLOWS a member of cookbook A to %s cookbook A's recipe",
      async (action) => {
        await expect(assertRecipeAccess(ctxMemberOfA, recipeId, action)).resolves.toBeUndefined();
      }
    );

    it("FORBIDS access from the personal view (no membership) to cookbook A's recipe", async () => {
      await expect(assertRecipeAccess(ctxPersonal, recipeId, "view")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("findRecipeForViewer returns null for a non-member of the recipe's cookbook", async () => {
      const recipe = await findRecipeForViewer(ctxMemberOfB, recipeId);

      expect(recipe).toBeNull();
    });

    it("findRecipeForViewer returns the recipe for a member of its cookbook", async () => {
      const recipe = await findRecipeForViewer(ctxMemberOfA, recipeId);

      expect(recipe).not.toBeNull();
    });

    it("a personal recipe (NULL household) is owner-only, not reachable by a cookbook member", async () => {
      getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: owner, householdId: null });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: recipeId, userId: owner, householdId: null })
      );

      await expect(assertRecipeAccess(ctxMemberOfA, recipeId, "view")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("an orphaned recipe (NULL owner) skips the permission check", async () => {
      getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: null, householdId: null });

      await expect(assertRecipeAccess(ctxMemberOfB, recipeId, "view")).resolves.toBeUndefined();
    });
  });
});
