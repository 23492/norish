// @vitest-environment node

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createRecipeShare,
  deleteRecipeShare,
  getActiveRecipeShareByToken,
  getAllRecipeShares,
  getPublicRecipeView,
  getRecipeShareById,
  getRecipeShareByToken,
  getRecipeSharesByUserId,
  revokeRecipeShare,
  updateRecipeShare,
} from "@norish/db/repositories/recipe-shares";
import {
  countActiveRecipeShares,
  getRecipeFull,
  getRecipeVisibility,
  setRecipeVisibility,
} from "@norish/db/repositories/recipes";
import * as schema from "@norish/db/schema";

import {
  createTestIngredient,
  createTestRecipeIngredients,
  createTestRecipeShare,
  createTestRecipeStep,
  getTestDb,
} from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

describe("recipe share repository", () => {
  let testUserId: string;
  let testRecipeId: string;
  const testBase = new RepositoryTestBase("test_recipe_shares");

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user, recipe] = await testBase.beforeEachTest();

    testUserId = user.id;
    testRecipeId = recipe.id;
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  it("hashes tokens at rest and resolves shares by raw token", async () => {
    const created = await createRecipeShare(testUserId, {
      recipeId: testRecipeId,
      expiresIn: "1week",
    });

    const token = created.url.replace("/share/", "");
    const db = getTestDb();
    const [stored] = await db
      .select()
      .from(schema.recipeShares)
      .where(eq(schema.recipeShares.id, created.id));

    expect(stored).toBeDefined();
    expect(stored.tokenHash).not.toBe(token);

    const byToken = await getRecipeShareByToken(token);

    expect(byToken?.id).toBe(created.id);
    expect(created.status).toBe("active");
    expect(created.expiresAt).not.toBeNull();
  });

  it("handles list, get, update, revoke, delete, and global list flows", async () => {
    const created = await createRecipeShare(testUserId, {
      recipeId: testRecipeId,
      expiresIn: "forever",
    });

    const listed = await getRecipeSharesByUserId(testUserId, testRecipeId);
    const fetched = await getRecipeShareById(created.id);

    expect(listed).toHaveLength(1);
    expect(fetched?.id).toBe(created.id);

    const updated = await updateRecipeShare({
      id: created.id,
      version: created.version,
      expiresIn: "1month",
    });

    expect(updated.stale).toBe(false);
    expect(updated.value?.version).toBe(created.version + 1);
    expect(updated.value?.expiresAt).not.toBeNull();

    const revoked = await revokeRecipeShare(created.id, updated.value!.version);

    expect(revoked.stale).toBe(false);
    expect(revoked.value?.status).toBe("revoked");
    expect(revoked.value?.revokedAt).not.toBeNull();

    const allShares = await getAllRecipeShares();

    expect(allShares).toHaveLength(1);

    const removed = await deleteRecipeShare(created.id, revoked.value!.version);

    expect(removed.stale).toBe(false);
    expect(await getRecipeShareById(created.id)).toBeNull();
  });

  it("rejects expired and revoked tokens uniformly and updates lastAccessedAt for active shares", async () => {
    const { share: activeShare, token: activeToken } = await createTestRecipeShare(
      testUserId,
      testRecipeId
    );
    const { token: expiredToken } = await createTestRecipeShare(testUserId, testRecipeId, {
      token: "expired-token",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const { token: revokedToken } = await createTestRecipeShare(testUserId, testRecipeId, {
      token: "revoked-token",
      revokedAt: new Date(),
    });

    expect(await getActiveRecipeShareByToken("missing-token")).toBeNull();
    expect(await getActiveRecipeShareByToken(expiredToken)).toBeNull();
    expect(await getActiveRecipeShareByToken(revokedToken)).toBeNull();

    const resolved = await getActiveRecipeShareByToken(activeToken, { touchLastAccessedAt: true });

    expect(resolved?.id).toBe(activeShare.id);
    expect(resolved?.lastAccessedAt).not.toBeNull();
  });

  it("builds a sanitized public recipe view with share-scoped media URLs", async () => {
    const db = getTestDb();
    const { token } = await createTestRecipeShare(testUserId, testRecipeId, {
      token: "public-token",
    });

    // SHARE-01: the public view is gated on visibility === "public".
    await db
      .update(schema.recipes)
      .set({ visibility: "public" })
      .where(eq(schema.recipes.id, testRecipeId));
    const ingredient = await createTestIngredient({ name: "Flour" });
    const step = await createTestRecipeStep(testRecipeId, "metric", {
      step: "Add toppings",
      order: "0",
    });

    await createTestRecipeIngredients(testRecipeId, ingredient.id, "metric", {
      amount: "200",
      unit: "g",
      order: "0",
    });

    await db
      .update(schema.recipes)
      .set({ image: `/recipes/${testRecipeId}/cover.jpg` })
      .where(eq(schema.recipes.id, testRecipeId));

    await db.insert(schema.recipeImages).values({
      recipeId: testRecipeId,
      image: `/recipes/${testRecipeId}/gallery.jpg`,
      order: "0",
    });
    await db.insert(schema.recipeVideos).values({
      recipeId: testRecipeId,
      video: `/recipes/${testRecipeId}/demo.mp4`,
      thumbnail: `/recipes/${testRecipeId}/demo-thumb.jpg`,
      duration: "42",
      order: "0",
    });
    await db.insert(schema.stepImages).values({
      stepId: step.id,
      image: `/recipes/${testRecipeId}/steps/step.jpg`,
      order: "0",
    });

    const publicRecipe = await getPublicRecipeView(testRecipeId, token);

    expect(publicRecipe).not.toBeNull();
    expect(publicRecipe).not.toHaveProperty("id");
    expect(publicRecipe).not.toHaveProperty("userId");
    expect(publicRecipe?.image).toBe(`/share/${token}/media/cover.jpg`);
    expect(publicRecipe?.images[0]?.image).toBe(`/share/${token}/media/gallery.jpg`);
    expect(publicRecipe?.videos[0]?.video).toBe(`/share/${token}/media/demo.mp4`);
    expect(publicRecipe?.videos[0]?.thumbnail).toBe(`/share/${token}/media/demo-thumb.jpg`);
    expect(publicRecipe?.steps[0]?.images[0]?.image).toBe(`/share/${token}/steps/step.jpg`);
    expect(publicRecipe?.recipeIngredients[0]).not.toHaveProperty("ingredientId");
    expect(publicRecipe?.steps[0]).not.toHaveProperty("version");
  });

  // ── SHARE-01: per-recipe visibility ───────────────────────────────────

  it("defaults a new recipe to private and round-trips visibility through getRecipeFull (real-parse)", async () => {
    // The default recipe created by the test base is private. getRecipeFull must
    // NOT throw "Failed to parse FullRecipeDTO" now that recipes carries a NOT
    // NULL visibility column (the 02-06 createSelectSchema regression class).
    const full = await getRecipeFull(testRecipeId);

    expect(full).not.toBeNull();
    expect(full?.visibility).toBe("private");

    const db = getTestDb();

    await db
      .update(schema.recipes)
      .set({ visibility: "public" })
      .where(eq(schema.recipes.id, testRecipeId));

    const updated = await getRecipeFull(testRecipeId);

    expect(updated?.visibility).toBe("public");
  });

  it("does NOT build a public view for a private or household recipe", async () => {
    const { token } = await createTestRecipeShare(testUserId, testRecipeId, {
      token: "gated-token",
    });
    const db = getTestDb();

    // private (default) -> null
    expect(await getPublicRecipeView(testRecipeId, token)).toBeNull();

    // household -> null
    await db
      .update(schema.recipes)
      .set({ visibility: "household" })
      .where(eq(schema.recipes.id, testRecipeId));
    expect(await getPublicRecipeView(testRecipeId, token)).toBeNull();

    // public -> served
    await db
      .update(schema.recipes)
      .set({ visibility: "public" })
      .where(eq(schema.recipes.id, testRecipeId));
    expect(await getPublicRecipeView(testRecipeId, token)).not.toBeNull();
  });

  it("sets visibility with an optimistic version bump and reports stale on a mismatch", async () => {
    const before = await getRecipeVisibility(testRecipeId);

    expect(before?.visibility).toBe("private");

    const applied = await setRecipeVisibility(testRecipeId, "public", before!.version);

    expect(applied.stale).toBe(false);
    expect(applied.value?.visibility).toBe("public");
    expect(applied.value?.version).toBe(before!.version + 1);

    // A stale version is rejected (no write).
    const stale = await setRecipeVisibility(testRecipeId, "private", before!.version);

    expect(stale.stale).toBe(true);
    expect((await getRecipeVisibility(testRecipeId))?.visibility).toBe("public");
  });

  it("counts only ACTIVE share links (excludes revoked + expired)", async () => {
    await createTestRecipeShare(testUserId, testRecipeId, { token: "active-1" });
    await createTestRecipeShare(testUserId, testRecipeId, {
      token: "revoked-1",
      revokedAt: new Date(),
    });
    await createTestRecipeShare(testUserId, testRecipeId, {
      token: "expired-1",
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(await countActiveRecipeShares(testRecipeId)).toBe(1);
  });
});
