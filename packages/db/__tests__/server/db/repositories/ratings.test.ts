// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getAverageRating,
  getUserRating,
  rateRecipe,
  removeUserRating,
} from "@norish/db/repositories/ratings";

import { createTestUser } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

describe("ratings repository — removeUserRating", () => {
  let userId: string;
  let recipeId: string;
  const testBase = new RepositoryTestBase("test_ratings_remove");

  beforeAll(async () => {
    await testBase.setup();
  });

  beforeEach(async () => {
    const [user, recipe] = await testBase.beforeEachTest();

    userId = user.id;
    recipeId = recipe.id;
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  it("removes the caller's own rating", async () => {
    await rateRecipe(userId, recipeId, 4);
    expect(await getUserRating(userId, recipeId)).toBe(4);

    const result = await removeUserRating(userId, recipeId);

    expect(result.removed).toBe(true);
    expect(await getUserRating(userId, recipeId)).toBeNull();
  });

  it("is a no-op when there is no rating to remove", async () => {
    const result = await removeUserRating(userId, recipeId);

    expect(result.removed).toBe(false);
    expect(await getUserRating(userId, recipeId)).toBeNull();
  });

  it("never deletes another user's rating (cross-user isolation)", async () => {
    const other = await createTestUser();

    await rateRecipe(userId, recipeId, 4);
    await rateRecipe(other.id, recipeId, 2);

    await removeUserRating(userId, recipeId);

    // The caller's rating is gone...
    expect(await getUserRating(userId, recipeId)).toBeNull();
    // ...but the other user's rating must survive untouched.
    expect(await getUserRating(other.id, recipeId)).toBe(2);

    const stats = await getAverageRating(recipeId);

    expect(stats.averageRating).toBe(2);
    expect(stats.ratingCount).toBe(1);
  });
});
