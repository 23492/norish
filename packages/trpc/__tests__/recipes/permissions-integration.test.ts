// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";

import { createMockFullRecipe } from "./test-utils";

// Hoisted mocks for the dependencies of the REAL permission path
// (assertRecipeAccess -> resolveRecipeCookbookPolicy -> getHouseholdPolicy +
// canAccessResource). The permission boundary itself is NOT mocked.
const getRecipeFullMock = vi.hoisted(() => vi.fn());
const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());
const getConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@norish/db", () => ({
  getRecipeFull: getRecipeFullMock,
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
}));

// resolveRecipeCookbookPolicy reads the recipe's OWN cookbook policy + admin
// from getHouseholdPolicy (household recipes) and the global default via
// getConfig (personal recipes).
vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn(),
  getHouseholdPolicy: getHouseholdPolicyMock,
}));

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: getConfigMock,
}));

// helpers.ts imports getRecipePermissionPolicy from the config loader (failure-
// emit path only); stub so the module graph resolves.
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

const GLOBAL_DEFAULT: RecipePermissionPolicy = {
  view: "everyone",
  edit: "household",
  delete: "household",
};

function policy(p: Partial<RecipePermissionPolicy>): RecipePermissionPolicy {
  return {
    view: p.view ?? "everyone",
    edit: p.edit ?? "household",
    delete: p.delete ?? "household",
  };
}

/** Drive the recipe's cookbook policy + admin (the per-cookbook source). */
function setCookbookPolicy(p: Partial<RecipePermissionPolicy>, adminUserId: string): void {
  getHouseholdPolicyMock.mockResolvedValue({ policy: policy(p), adminUserId });
}

describe("recipe permission enforcement (real boundary, per-cookbook)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock.mockResolvedValue(GLOBAL_DEFAULT);
  });

  describe("owner / admin / everyone", () => {
    it("owner can always view their own recipe regardless of policy", async () => {
      setCookbookPolicy({ view: "owner" }, "cookbook-admin");
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "owner-id", householdId: "cookbook-a" })
      );

      const ctx = { user: { id: "owner-id" }, memberHouseholdIds: [], isServerAdmin: false };

      expect(await findRecipeForViewer(ctx, "r1")).not.toBeNull();
    });

    it("server admin can view any recipe", async () => {
      setCookbookPolicy({ view: "owner" }, "cookbook-admin");
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "someone-else", householdId: "cookbook-x" })
      );

      const ctx = { user: { id: "admin-id" }, memberHouseholdIds: [], isServerAdmin: true };

      expect(await findRecipeForViewer(ctx, "r1")).not.toBeNull();
    });

    it("a cookbook with view=everyone lets any user view its recipe", async () => {
      setCookbookPolicy({ view: "everyone" }, "cookbook-admin");
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "owner-id", householdId: "cookbook-a" })
      );

      const ctx = { user: { id: "stranger" }, memberHouseholdIds: [], isServerAdmin: false };

      expect(await findRecipeForViewer(ctx, "r1")).not.toBeNull();
    });

    it("owner-level view hides a recipe from a non-owner member", async () => {
      setCookbookPolicy({ view: "owner" }, "cookbook-admin");
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: "r1", userId: "owner-id", householdId: "cookbook-a" })
      );

      const ctx = { user: { id: "stranger" }, memberHouseholdIds: ["cookbook-a"], isServerAdmin: false };

      expect(await findRecipeForViewer(ctx, "r1")).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // DECISION #3: edit/delete = household => owner OR cookbook admin.
  // ---------------------------------------------------------------------------
  describe("admin-edits-any / members-edit-own (edit/delete = household)", () => {
    const cookbookA = "cookbook-a-id";
    const owner = "owner-in-A";
    const cookbookAdmin = "admin-in-A";
    const recipeId = "recipe-in-A";

    beforeEach(() => {
      setCookbookPolicy({ view: "household", edit: "household", delete: "household" }, cookbookAdmin);
      getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: owner, householdId: cookbookA });
      getRecipeFullMock.mockResolvedValue(
        createMockFullRecipe({ id: recipeId, userId: owner, householdId: cookbookA })
      );
    });

    it.each(["edit", "delete"] as const)(
      "the cookbook ADMIN may %s another member's recipe",
      async (action) => {
        const ctxAdmin = { user: { id: cookbookAdmin }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

        await expect(assertRecipeAccess(ctxAdmin, recipeId, action)).resolves.toBeUndefined();
      }
    );

    it.each(["edit", "delete"] as const)(
      "a non-admin MEMBER may NOT %s another member's recipe",
      async (action) => {
        const ctxMember = { user: { id: "plain-member" }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

        await expect(assertRecipeAccess(ctxMember, recipeId, action)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    );

    it.each(["edit", "delete"] as const)(
      "the OWNER may %s their own recipe (members-edit-own)",
      async (action) => {
        const ctxOwner = { user: { id: owner }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

        await expect(assertRecipeAccess(ctxOwner, recipeId, action)).resolves.toBeUndefined();
      }
    );
  });

  // ---------------------------------------------------------------------------
  // SECURITY-CRITICAL (HOUSE-06): a member of cookbook B can never view/edit/
  // delete a recipe that lives in cookbook A, regardless of A's policy.
  // ---------------------------------------------------------------------------
  describe("cross-cookbook isolation (household policy)", () => {
    const cookbookA = "cookbook-a-id";
    const cookbookAdmin = "admin-in-A";
    const recipeId = "recipe-in-A";
    const owner = "owner-in-A";

    const ctxMemberOfA = { user: { id: "user-U" }, memberHouseholdIds: [cookbookA], isServerAdmin: false };
    const ctxMemberOfB = { user: { id: "user-W" }, memberHouseholdIds: ["cookbook-b-id"], isServerAdmin: false };
    const ctxPersonal = { user: { id: "user-W" }, memberHouseholdIds: [], isServerAdmin: false };

    beforeEach(() => {
      setCookbookPolicy({ view: "household", edit: "household", delete: "household" }, cookbookAdmin);
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
      "ALLOWS a member of cookbook A to %s cookbook A's recipe (admin)",
      async (action) => {
        // ctxMemberOfA is the cookbook admin here (so edit/delete pass too).
        const ctxAdminOfA = { user: { id: cookbookAdmin }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

        await expect(assertRecipeAccess(ctxAdminOfA, recipeId, action)).resolves.toBeUndefined();
      }
    );

    it("ALLOWS a plain member of cookbook A to VIEW cookbook A's recipe", async () => {
      await expect(assertRecipeAccess(ctxMemberOfA, recipeId, "view")).resolves.toBeUndefined();
    });

    it("FORBIDS access from the personal view (no membership) to cookbook A's recipe", async () => {
      await expect(assertRecipeAccess(ctxPersonal, recipeId, "view")).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("findRecipeForViewer returns null for a non-member of the recipe's cookbook", async () => {
      expect(await findRecipeForViewer(ctxMemberOfB, recipeId)).toBeNull();
    });

    it("findRecipeForViewer returns the recipe for a member of its cookbook", async () => {
      expect(await findRecipeForViewer(ctxMemberOfA, recipeId)).not.toBeNull();
    });

    it("a personal recipe (NULL household) is owner-only, not reachable by a cookbook member", async () => {
      // Personal recipe -> resolver uses the global default (getConfig), null admin.
      getConfigMock.mockResolvedValue({ view: "household", edit: "household", delete: "household" });
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
