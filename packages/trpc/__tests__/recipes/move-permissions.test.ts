// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";

// Same mock harness as permissions-integration.test.ts: the REAL permission
// boundary (assertRecipeAccess -> resolveRecipeCookbookPolicy -> canAccessResource)
// runs; only its DB dependencies are mocked. This suite pins the MOVE guard
// (assertRecipeMoveAllowed) adversarially — CKBK-MOVE-01 / HOUSE-06 / POLICY-01.
const getRecipeFullMock = vi.hoisted(() => vi.fn());
const getRecipeOwnerAndHouseholdMock = vi.hoisted(() => vi.fn());
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());
const getConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@norish/db", () => ({
  getRecipeFull: getRecipeFullMock,
  getRecipeOwnerAndHousehold: getRecipeOwnerAndHouseholdMock,
}));

vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn(),
  getHouseholdPolicy: getHouseholdPolicyMock,
}));

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: getConfigMock,
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
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
  resolveRecipeRealtimeScope: vi.fn((_recipeId: string, fallback: unknown) =>
    Promise.resolve({ viewPolicy: "household", ctx: fallback })
  ),
  resolveHouseholdRealtimeScope: vi.fn((householdId: string | null, fallback: { userId: string }) =>
    Promise.resolve({
      viewPolicy: "household",
      ctx: { userId: fallback.userId, householdKey: householdId ?? fallback.userId },
    })
  ),
}));

// Import the REAL move guard (which calls the REAL assertRecipeAccess boundary).
const { assertRecipeMoveAllowed } = await import("../../src/routers/recipes/helpers");

function policy(p: Partial<RecipePermissionPolicy>): RecipePermissionPolicy {
  return {
    view: p.view ?? "everyone",
    edit: p.edit ?? "household",
    delete: p.delete ?? "household",
  };
}

function setCookbookPolicy(p: Partial<RecipePermissionPolicy>, adminUserId: string): void {
  getHouseholdPolicyMock.mockResolvedValue({ policy: policy(p), adminUserId });
}

// Fixture: recipe r1 owned by `owner` in cookbook A (admin `admin`), plus a
// second cookbook B the move can target.
const cookbookA = "cookbook-a-id";
const cookbookB = "cookbook-b-id";
const owner = "owner-in-A";
const admin = "admin-in-A";
const recipeId = "recipe-in-A";

const GLOBAL_DEFAULT: RecipePermissionPolicy = {
  view: "everyone",
  edit: "household",
  delete: "household",
};

describe("assertRecipeMoveAllowed (real boundary) — CKBK-MOVE-01", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock.mockResolvedValue(GLOBAL_DEFAULT);
    getRecipeOwnerAndHouseholdMock.mockResolvedValue({ userId: owner, householdId: cookbookA });
    getRecipeFullMock.mockResolvedValue(null);
  });

  // --- SOURCE gate (POLICY-01 edit): seed both `household` AND the `everyone`
  //     sibling — the live default is `everyone`, and canAccessResource collapses
  //     `edit = everyone` to admin-or-owner, so both must deny the plain member. ---
  describe.each(["household", "everyone"] as const)("source edit=%s", (editLevel) => {
    beforeEach(() => setCookbookPolicy({ view: "household", edit: editLevel }, admin));

    it("FORBIDS a non-member of the source cookbook from moving its recipe", async () => {
      const ctx = { user: { id: "stranger" }, memberHouseholdIds: [cookbookB], isServerAdmin: false };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, cookbookB)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("FORBIDS a non-admin, non-owner member from moving another member's recipe", async () => {
      // Member of BOTH cookbooks (so the DESTINATION gate can't be what fails) —
      // only the SOURCE edit gate can reject here.
      const ctx = {
        user: { id: "plain-member" },
        memberHouseholdIds: [cookbookA, cookbookB],
        isServerAdmin: false,
      };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, cookbookB)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("ALLOWS the source cookbook admin to move the recipe", async () => {
      const ctx = {
        user: { id: admin },
        memberHouseholdIds: [cookbookA, cookbookB],
        isServerAdmin: false,
      };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, cookbookB)).resolves.toMatchObject({
        sourceHouseholdId: cookbookA,
        ownerId: owner,
      });
    });

    it("ALLOWS the owner to move their own recipe", async () => {
      const ctx = {
        user: { id: owner },
        memberHouseholdIds: [cookbookA, cookbookB],
        isServerAdmin: false,
      };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, cookbookB)).resolves.toBeTruthy();
    });
  });

  // --- DESTINATION gate ---
  describe("destination gate", () => {
    beforeEach(() => setCookbookPolicy({ view: "household", edit: "household" }, admin));

    it("FORBIDS moving a recipe INTO a household the actor is not a member of", async () => {
      // Owner (passes source edit) but NOT a member of the destination cookbook B.
      const ctx = { user: { id: owner }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, cookbookB)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("FORBIDS a non-owner (source admin) from moving the recipe into Personal", async () => {
      const ctx = { user: { id: admin }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, null)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("ALLOWS the owner to move the recipe into Personal", async () => {
      const ctx = { user: { id: owner }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, null)).resolves.toMatchObject({
        sourceHouseholdId: cookbookA,
        ownerId: owner,
      });
    });

    it("REJECTS a no-op move to the recipe's current cookbook", async () => {
      const ctx = { user: { id: owner }, memberHouseholdIds: [cookbookA], isServerAdmin: false };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, cookbookA)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("ALLOWS a server admin to move into any household (parity with canAccessResource)", async () => {
      const ctx = { user: { id: "root" }, memberHouseholdIds: [], isServerAdmin: true };

      await expect(assertRecipeMoveAllowed(ctx, recipeId, cookbookB)).resolves.toBeTruthy();
    });
  });
});
