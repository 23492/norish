// @vitest-environment node

import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMockAuthedContext,
  createMockFullRecipe,
  createMockHousehold,
  createMockRecipeDashboard,
  createMockUser,
} from "./test-utils";

const assertRecipeAccessMock = vi.hoisted(() => vi.fn());
const createRecipeShareMock = vi.hoisted(() => vi.fn());
const deleteRecipeShareMock = vi.hoisted(() => vi.fn());
const emitByPolicyMock = vi.hoisted(() => vi.fn());
const getActiveRecipeShareByTokenMock = vi.hoisted(() => vi.fn());
const getTimerKeywordsMock = vi.hoisted(() => vi.fn());
const getRecipePermissionPolicyMock = vi.hoisted(() => vi.fn());
const getPublicRecipeViewMock = vi.hoisted(() => vi.fn());
const getRecipeFullMock = vi.hoisted(() => vi.fn());
const getRecipeVisibilityMock = vi.hoisted(() => vi.fn());
const setRecipeVisibilityMock = vi.hoisted(() => vi.fn());
const countActiveRecipeSharesMock = vi.hoisted(() => vi.fn());
const copyRecipeForSaveMock = vi.hoisted(() => vi.fn());
const dashboardRecipeMock = vi.hoisted(() => vi.fn());
const copyRecipeImagesDirMock = vi.hoisted(() => vi.fn());
const getRecipeShareByIdMock = vi.hoisted(() => vi.fn());
const getRecipeSharesByUserIdMock = vi.hoisted(() => vi.fn());
const getRecipeShareStatusMock = vi.hoisted(() => vi.fn());
const getUnitsMock = vi.hoisted(() => vi.fn());
const isTimersEnabledMock = vi.hoisted(() => vi.fn());
const revokeRecipeShareMock = vi.hoisted(() => vi.fn());
const updateRecipeShareMock = vi.hoisted(() => vi.fn());
const getCachedHouseholdForUserMock = vi.hoisted(() => vi.fn());
const isUserServerAdminMock = vi.hoisted(() => vi.fn());
const getHouseholdsForUserMock = vi.hoisted(() => vi.fn(() => Promise.resolve([])));

vi.mock("../../src/routers/recipes/helpers", () => ({
  assertRecipeAccess: assertRecipeAccessMock,
}));

vi.mock("../../src/helpers", () => ({
  emitByPolicy: emitByPolicyMock,
}));

vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  getRecipePermissionPolicy: getRecipePermissionPolicyMock,
  getTimerKeywords: getTimerKeywordsMock,
  getUnits: getUnitsMock,
  isTimersEnabled: isTimersEnabledMock,
}));

vi.mock("@norish/db/repositories/recipe-shares", () => ({
  createRecipeShare: createRecipeShareMock,
  deleteRecipeShare: deleteRecipeShareMock,
  getActiveRecipeShareByToken: getActiveRecipeShareByTokenMock,
  getPublicRecipeView: getPublicRecipeViewMock,
  getRecipeShareById: getRecipeShareByIdMock,
  getRecipeShareStatus: getRecipeShareStatusMock,
  getRecipeSharesByUserId: getRecipeSharesByUserIdMock,
  revokeRecipeShare: revokeRecipeShareMock,
  updateRecipeShare: updateRecipeShareMock,
}));

vi.mock("@norish/db/repositories/recipes", () => ({
  getRecipeFull: getRecipeFullMock,
  getRecipeVisibility: getRecipeVisibilityMock,
  setRecipeVisibility: setRecipeVisibilityMock,
  countActiveRecipeShares: countActiveRecipeSharesMock,
  copyRecipeForSave: copyRecipeForSaveMock,
  dashboardRecipe: dashboardRecipeMock,
}));

vi.mock("@norish/shared-server/media/storage", () => ({
  copyRecipeImagesDir: copyRecipeImagesDirMock,
}));

vi.mock("@norish/db", () => ({
  getCachedHouseholdForUser: getCachedHouseholdForUserMock,
  isUserServerAdmin: isUserServerAdminMock,
  getHouseholdsForUser: getHouseholdsForUserMock,
}));

const { recipeSharesProcedures } = await import("../../src/routers/recipes/shares");

describe("recipe share procedures", () => {
  const user = createMockUser();
  const household = createMockHousehold();
  const recipeId = "123e4567-e89b-12d3-a456-426614174000";
  const shareId = "123e4567-e89b-12d3-a456-426614174001";
  const authedCtx = {
    ...createMockAuthedContext(user, household),
    connectionId: null,
    multiplexer: null,
    operationId: null,
  };
  const publicCtx = {
    user: null,
    household: null,
    connectionId: null,
    multiplexer: null,
    operationId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    isUserServerAdminMock.mockResolvedValue(false);
    getCachedHouseholdForUserMock.mockResolvedValue(household);
    // Middleware re-derives memberHouseholdIds from this; match the authed ctx household.
    getHouseholdsForUserMock.mockResolvedValue([household]);
    getRecipePermissionPolicyMock.mockResolvedValue({ view: "household" });
    getRecipeShareStatusMock.mockReturnValue("active");
    // Visibility-transition repo defaults (SHARE-01): create -> public,
    // revoke/delete -> private when no active shares remain.
    getRecipeVisibilityMock.mockResolvedValue({ visibility: "private", version: 1 });
    setRecipeVisibilityMock.mockResolvedValue({
      applied: true,
      stale: false,
      value: { visibility: "public", version: 2 },
    });
    countActiveRecipeSharesMock.mockResolvedValue(0);
    getUnitsMock.mockResolvedValue({});
    isTimersEnabledMock.mockResolvedValue(true);
    getTimerKeywordsMock.mockResolvedValue({
      enabled: true,
      hours: ["hour"],
      minutes: ["minute"],
      seconds: ["second"],
      isOverridden: false,
    });
  });

  it("creates a share after enforcing recipe edit access", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    assertRecipeAccessMock.mockResolvedValue(undefined);
    createRecipeShareMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
      status: "active",
      url: "/share/token-1",
    });

    const result = await caller.shareCreate({ recipeId, expiresIn: "forever" });

    expect(assertRecipeAccessMock).toHaveBeenCalledWith(authedCtx, recipeId, "edit");
    expect(createRecipeShareMock).toHaveBeenCalledWith(user.id, {
      recipeId,
      expiresIn: "forever",
    });
    expect(emitByPolicyMock).toHaveBeenCalledWith(
      expect.anything(),
      "household",
      { userId: user.id, householdKey: authedCtx.householdKey },
      "shareCreated",
      {
        type: "created",
        recipeId,
        shareId,
        version: 1,
      }
    );
    expect(result.url).toBe("/share/token-1");
  });

  it("returns the public recipe for a valid anonymous token", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);
    const recipe = createMockFullRecipe({ id: recipeId });

    getActiveRecipeShareByTokenMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 2,
    });
    getRecipeFullMock.mockResolvedValue(recipe);
    getPublicRecipeViewMock.mockResolvedValue({
      name: recipe.name,
      description: recipe.description,
      notes: recipe.notes ?? null,
      url: recipe.url,
      image: `/share/valid-token/media/cover.jpg`,
      servings: recipe.servings,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      totalMinutes: recipe.totalMinutes,
      systemUsed: recipe.systemUsed,
      calories: recipe.calories,
      fat: recipe.fat,
      carbs: recipe.carbs,
      protein: recipe.protein,
      categories: recipe.categories,
      tags: [{ name: "dinner" }],
      recipeIngredients: [
        {
          ingredientName: "Flour",
          amount: 200,
          unit: "g",
          systemUsed: "metric",
          order: 0,
        },
      ],
      steps: [{ step: "Mix", systemUsed: "metric", order: 0, images: [] }],
      author: { name: "Test User", image: null },
      images: [],
      videos: [],
    });

    const result = await caller.getShared({ token: "valid-token" });

    expect(getActiveRecipeShareByTokenMock).toHaveBeenCalledWith("valid-token", {
      touchLastAccessedAt: true,
    });
    expect(getRecipeFullMock).toHaveBeenCalledWith(recipeId);
    expect(getPublicRecipeViewMock).toHaveBeenCalledWith(recipeId, "valid-token");
    expect(result.image).toBe("/share/valid-token/media/cover.jpg");
  });

  it("returns the public share config for a valid share token", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);

    getActiveRecipeShareByTokenMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 2,
    });
    getRecipeFullMock.mockResolvedValue(createMockFullRecipe({ id: recipeId }));
    getUnitsMock.mockResolvedValue({
      gram: {
        short: [{ locale: "en", name: "g" }],
        plural: [{ locale: "en", name: "grams" }],
        alternates: ["gram"],
      },
    });
    isTimersEnabledMock.mockResolvedValue(false);
    getTimerKeywordsMock.mockResolvedValue({
      enabled: true,
      hours: ["hr"],
      minutes: ["min"],
      seconds: ["sec"],
      isOverridden: true,
    });

    const result = await caller.sharePublicConfig({ token: "valid-token" });

    expect(getActiveRecipeShareByTokenMock).toHaveBeenCalledWith("valid-token", {
      touchLastAccessedAt: true,
    });
    expect(getUnitsMock).toHaveBeenCalledOnce();
    expect(isTimersEnabledMock).toHaveBeenCalledOnce();
    expect(getTimerKeywordsMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      units: {
        gram: {
          short: [{ locale: "en", name: "g" }],
          plural: [{ locale: "en", name: "grams" }],
          alternates: ["gram"],
        },
      },
      timersEnabled: false,
      timerKeywords: {
        enabled: true,
        hours: ["hr"],
        minutes: ["min"],
        seconds: ["sec"],
        isOverridden: true,
      },
    });
  });

  it("rejects public share config requests for invalid tokens", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);

    getActiveRecipeShareByTokenMock.mockResolvedValue(null);

    await expect(caller.sharePublicConfig({ token: "invalid-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    expect(getUnitsMock).not.toHaveBeenCalled();
    expect(isTimersEnabledMock).not.toHaveBeenCalled();
    expect(getTimerKeywordsMock).not.toHaveBeenCalled();
  });

  it("rejects invalid, expired, and revoked public tokens with the same not-found error", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);

    getActiveRecipeShareByTokenMock.mockResolvedValue(null);

    await expect(caller.getShared({ token: "invalid-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.getShared({ token: "expired-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.getShared({ token: "revoked-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("does not allow a user to manage another user's share", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    getRecipeShareByIdMock.mockResolvedValue({
      id: shareId,
      userId: "other-user",
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });

    await expect(caller.shareGet({ id: shareId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertRecipeAccessMock).not.toHaveBeenCalled();
  });

  it("emits a policy-scoped realtime event when a share is updated", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    getRecipeShareByIdMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    updateRecipeShareMock.mockResolvedValue({
      stale: false,
      value: {
        id: shareId,
        userId: user.id,
        recipeId,
        expiresAt: null,
        revokedAt: null,
        lastAccessedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 2,
        status: "active",
      },
    });

    await caller.shareUpdate({ id: shareId, version: 1, expiresIn: "1month" });

    expect(emitByPolicyMock).toHaveBeenCalledWith(
      expect.anything(),
      "household",
      { userId: user.id, householdKey: authedCtx.householdKey },
      "shareUpdated",
      {
        type: "updated",
        recipeId,
        shareId,
        version: 2,
      }
    );
  });

  it("emits a policy-scoped realtime event when a share is revoked", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    getRecipeShareByIdMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 2,
    });
    revokeRecipeShareMock.mockResolvedValue({
      stale: false,
      value: {
        id: shareId,
        userId: user.id,
        recipeId,
        expiresAt: null,
        revokedAt: new Date(),
        lastAccessedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 3,
        status: "revoked",
      },
    });

    await caller.shareRevoke({ id: shareId, version: 2 });

    expect(emitByPolicyMock).toHaveBeenCalledWith(
      expect.anything(),
      "household",
      { userId: user.id, householdKey: authedCtx.householdKey },
      "shareRevoked",
      {
        type: "revoked",
        recipeId,
        shareId,
        version: 3,
      }
    );
  });

  it("emits a policy-scoped realtime event when a share is deleted", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    getRecipeShareByIdMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 4,
    });
    deleteRecipeShareMock.mockResolvedValue({ stale: false });

    await caller.shareDelete({ id: shareId, version: 4 });

    expect(emitByPolicyMock).toHaveBeenCalledWith(
      expect.anything(),
      "household",
      { userId: user.id, householdKey: authedCtx.householdKey },
      "shareDeleted",
      {
        type: "deleted",
        recipeId,
        shareId,
        version: 4,
      }
    );
  });

  // ── SHARE-01: per-recipe visibility gate ──────────────────────────────

  function mockActiveShareForToken() {
    getActiveRecipeShareByTokenMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 2,
    });
  }

  it("does NOT serve a PRIVATE recipe via the public token route", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);

    // A valid, active share token exists, but the recipe is private.
    mockActiveShareForToken();
    getRecipeFullMock.mockResolvedValue(createMockFullRecipe({ id: recipeId, visibility: "private" }));

    // SHARE-01 gate lives in sharedRecipeProcedure (the public choke point):
    // a non-public recipe is the SAME opaque NOT_FOUND as a missing token.
    await expect(caller.getShared({ token: "valid-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // The gate short-circuits BEFORE building the public view.
    expect(getPublicRecipeViewMock).not.toHaveBeenCalled();
  });

  it("does NOT serve a HOUSEHOLD recipe via the public token route", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);

    mockActiveShareForToken();
    getRecipeFullMock.mockResolvedValue(
      createMockFullRecipe({ id: recipeId, visibility: "household" })
    );

    await expect(caller.getShared({ token: "valid-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getPublicRecipeViewMock).not.toHaveBeenCalled();
  });

  it("serves ONLY a PUBLIC recipe via the public token route, with a single-recipe payload", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);
    const recipe = createMockFullRecipe({ id: recipeId, visibility: "public" });

    mockActiveShareForToken();
    getRecipeFullMock.mockResolvedValue(recipe);
    getPublicRecipeViewMock.mockResolvedValue({
      name: recipe.name,
      description: recipe.description,
      notes: recipe.notes ?? null,
      url: recipe.url,
      image: "/share/valid-token/media/cover.jpg",
      servings: recipe.servings,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      totalMinutes: recipe.totalMinutes,
      systemUsed: recipe.systemUsed,
      calories: recipe.calories,
      fat: recipe.fat,
      carbs: recipe.carbs,
      protein: recipe.protein,
      categories: recipe.categories,
      tags: [{ name: "dinner" }],
      recipeIngredients: [
        { ingredientName: "Flour", amount: 200, unit: "g", systemUsed: "metric", order: 0 },
      ],
      steps: [{ step: "Mix", systemUsed: "metric", order: 0, images: [] }],
      author: { name: "Test User", image: null },
      images: [],
      videos: [],
    });

    const result = await caller.getShared({ token: "valid-token" });

    expect(getPublicRecipeViewMock).toHaveBeenCalledWith(recipeId, "valid-token");
    // The public payload is single-recipe display data ONLY: never the owner's
    // id/userId/householdId, member lists, cookbook contents, or share tokens.
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("householdId");
    expect(result).not.toHaveProperty("tokenHash");
    expect(result.author).not.toHaveProperty("id");
    expect(result.name).toBe(recipe.name);
  });

  it("promotes the recipe to PUBLIC when a share link is created", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    assertRecipeAccessMock.mockResolvedValue(undefined);
    getRecipeVisibilityMock.mockResolvedValue({ visibility: "private", version: 7 });
    createRecipeShareMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
      status: "active",
      url: "/share/token-1",
    });

    await caller.shareCreate({ recipeId, expiresIn: "forever" });

    expect(setRecipeVisibilityMock).toHaveBeenCalledWith(recipeId, "public", 7);
  });

  it("reverts the recipe to PRIVATE when the last active share is revoked", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    getRecipeShareByIdMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 2,
    });
    revokeRecipeShareMock.mockResolvedValue({
      stale: false,
      value: {
        id: shareId,
        userId: user.id,
        recipeId,
        expiresAt: null,
        revokedAt: new Date(),
        lastAccessedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 3,
        status: "revoked",
      },
    });
    countActiveRecipeSharesMock.mockResolvedValue(0);
    getRecipeVisibilityMock.mockResolvedValue({ visibility: "public", version: 9 });

    await caller.shareRevoke({ id: shareId, version: 2 });

    expect(setRecipeVisibilityMock).toHaveBeenCalledWith(recipeId, "private", 9);
  });

  it("keeps the recipe PUBLIC when other active shares remain after a revoke", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    getRecipeShareByIdMock.mockResolvedValue({
      id: shareId,
      userId: user.id,
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 2,
    });
    revokeRecipeShareMock.mockResolvedValue({
      stale: false,
      value: {
        id: shareId,
        userId: user.id,
        recipeId,
        expiresAt: null,
        revokedAt: new Date(),
        lastAccessedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 3,
        status: "revoked",
      },
    });
    countActiveRecipeSharesMock.mockResolvedValue(1);

    await caller.shareRevoke({ id: shareId, version: 2 });

    expect(setRecipeVisibilityMock).not.toHaveBeenCalled();
  });

  it("sets visibility after enforcing recipe EDIT access", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    assertRecipeAccessMock.mockResolvedValue(undefined);
    setRecipeVisibilityMock.mockResolvedValue({
      applied: true,
      stale: false,
      value: { visibility: "public", version: 5 },
    });
    getRecipeFullMock.mockResolvedValue(createMockFullRecipe({ id: recipeId, visibility: "public" }));

    const result = await caller.shareSetVisibility({
      recipeId,
      visibility: "public",
      version: 4,
    });

    expect(assertRecipeAccessMock).toHaveBeenCalledWith(authedCtx, recipeId, "edit");
    expect(setRecipeVisibilityMock).toHaveBeenCalledWith(recipeId, "public", 4);
    expect(result).toEqual({ recipeId, visibility: "public", version: 5, stale: false });
  });

  it("rejects setVisibility when the caller lacks EDIT access", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    assertRecipeAccessMock.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to access this recipe" })
    );

    await expect(
      caller.shareSetVisibility({ recipeId, visibility: "public", version: 4 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(setRecipeVisibilityMock).not.toHaveBeenCalled();
  });

  // ── SHARE-02: save a shared (public) recipe into the saver's active cookbook ─

  const savedRecipeId = "123e4567-e89b-12d3-a456-426614174099";

  function mockActivePublicShare(recipe = createMockFullRecipe({ id: recipeId, visibility: "public" })) {
    getActiveRecipeShareByTokenMock.mockResolvedValue({
      id: shareId,
      userId: "some-other-owner",
      recipeId,
      tokenHash: "hashed",
      expiresAt: null,
      revokedAt: null,
      lastAccessedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    });
    getRecipeFullMock.mockResolvedValue(recipe);

    return recipe;
  }

  it("saves a valid PUBLIC-token recipe as a NEW recipe owned by the saver in their ACTIVE cookbook", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);
    const source = mockActivePublicShare();

    copyRecipeForSaveMock.mockResolvedValue(savedRecipeId);
    dashboardRecipeMock.mockResolvedValue(createMockRecipeDashboard({ id: savedRecipeId }));

    const result = await caller.saveShared({ token: "valid-token" });

    // The save is gated on the SAME token->recipe path as the public view.
    expect(getActiveRecipeShareByTokenMock).toHaveBeenCalledWith("valid-token", {
      touchLastAccessedAt: true,
    });
    expect(getRecipeFullMock).toHaveBeenCalledWith(recipeId);

    // The copy is owned by the SAVER (user.id) and lands in their ACTIVE cookbook
    // (household.id) — NOT the source owner / source cookbook. A fresh new id is
    // generated server-side (never accepted from the client).
    expect(copyRecipeForSaveMock).toHaveBeenCalledTimes(1);
    const [copiedSource, copiedUserId, copiedHouseholdId, newId] =
      copyRecipeForSaveMock.mock.calls[0]!;

    expect(copiedSource).toBe(source);
    expect(copiedUserId).toBe(user.id);
    expect(copiedHouseholdId).toBe(household.id);
    expect(newId).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId).not.toBe(recipeId);

    // The saved copy gets its OWN media files (source id -> the new id).
    expect(copyRecipeImagesDirMock).toHaveBeenCalledWith(source.id, newId);

    // The result carries ONLY the new recipe id (the saver's copy).
    expect(result).toEqual({ recipeId: savedRecipeId });

    // It surfaces live in the saver's cookbook like a create.
    expect(emitByPolicyMock).toHaveBeenCalledWith(
      expect.anything(),
      "household",
      { userId: user.id, householdKey: household.id },
      "created",
      expect.objectContaining({ recipe: expect.objectContaining({ id: savedRecipeId }) })
    );
  });

  it("does NOT save a PRIVATE recipe reached via a valid token (mirrors the SHARE-01 gate)", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    // A valid, active share token — but the recipe is private. The shared gate
    // rejects with the SAME opaque NOT_FOUND, so a user cannot save a recipe
    // that is not publicly shared.
    mockActivePublicShare(createMockFullRecipe({ id: recipeId, visibility: "private" }));

    await expect(caller.saveShared({ token: "valid-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // No copy of an unshared recipe.
    expect(copyRecipeForSaveMock).not.toHaveBeenCalled();
    expect(copyRecipeImagesDirMock).not.toHaveBeenCalled();
  });

  it("does NOT save a HOUSEHOLD recipe reached via a valid token", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    mockActivePublicShare(createMockFullRecipe({ id: recipeId, visibility: "household" }));

    await expect(caller.saveShared({ token: "valid-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(copyRecipeForSaveMock).not.toHaveBeenCalled();
  });

  it("rejects save with an invalid / revoked / expired token (same opaque not-found, no copy)", async () => {
    const caller = recipeSharesProcedures.createCaller(authedCtx as never);

    // getActiveRecipeShareByToken already filters expired/revoked -> null.
    getActiveRecipeShareByTokenMock.mockResolvedValue(null);

    await expect(caller.saveShared({ token: "invalid-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getRecipeFullMock).not.toHaveBeenCalled();
    expect(copyRecipeForSaveMock).not.toHaveBeenCalled();
  });

  it("requires authentication to save (logged-out caller is rejected, no copy)", async () => {
    const caller = recipeSharesProcedures.createCaller(publicCtx as never);

    mockActivePublicShare();

    await expect(caller.saveShared({ token: "valid-token" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(copyRecipeForSaveMock).not.toHaveBeenCalled();
  });
});
