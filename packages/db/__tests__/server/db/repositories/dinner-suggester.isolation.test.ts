// @vitest-environment node
/**
 * DINNER-01 cross-cookbook isolation (HOUSE-06, security-critical).
 *
 * The "what's for dinner" suggester's candidate set (getDinnerSuggestionCandidates)
 * reuses buildViewPolicyCondition wholesale, so the per-cookbook boundary is
 * INHERITED. These tests prove a viewer who is a member of cookbook A can never
 * be handed cookbook B's recipe as a dinner candidate — including under the LIVE
 * `view: "everyone"` policy (the config production actually runs, and the branch
 * that hid the Phase 22 family). They also confirm the candidate query carries
 * the recipe's own tags (the season signal) and a household-scoped ratings
 * aggregate (the recency/quality signal).
 *
 * The rater-name path (avatars/stars/thought-bubble in the UI) is NOT touched
 * here: the suggester never fetches rater names — the UI composes with the
 * already-gated ratings.getRaters procedure (RATE-01), covered by
 * packages/trpc/__tests__/ratings/raters.test.ts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RecipeListContext } from "@norish/db/repositories/recipes";
import { addUserToHousehold, createHousehold, getDinnerSuggestionCandidates, setConfig } from "@norish/db";
import { ServerConfigKeys } from "@norish/config/zod/server-config";
import { recipeRatings, recipes, recipeTags, tags } from "@norish/db/schema";

import { createTestUser, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

describe("cross-cookbook dinner-suggestion isolation (HOUSE-06 / DINNER-01)", () => {
  const testBase = new RepositoryTestBase("dinner_isolation");

  // U is a member of cookbook A only; V is a member of cookbook B only.
  let userU: string;
  let userV: string;
  let cookbookA: string;
  let cookbookB: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userU = user.id;

    const otherUser = await createTestUser();

    userV = otherUser.id;

    const householdA = await createHousehold({ name: "Cookbook A", adminUserId: userU });
    const householdB = await createHousehold({ name: "Cookbook B", adminUserId: userV });

    cookbookA = householdA.id;
    cookbookB = householdB.id;

    await addUserToHousehold({ householdId: cookbookA, userId: userU });
    await addUserToHousehold({ householdId: cookbookB, userId: userV });

    await setConfig(
      ServerConfigKeys.RECIPE_PERMISSION_POLICY,
      { view: "household", edit: "household", delete: "household" },
      null
    );
  });

  async function insertRecipe(opts: {
    name: string;
    userId: string | null;
    householdId: string | null;
  }): Promise<string> {
    const db = getTestDb();
    const [row] = await db
      .insert(recipes)
      .values({
        name: opts.name,
        userId: opts.userId,
        householdId: opts.householdId,
        servings: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: recipes.id });

    return row.id;
  }

  async function attachTag(recipeId: string, tagName: string): Promise<void> {
    const db = getTestDb();
    const [tag] = await db.insert(tags).values({ name: tagName }).returning({ id: tags.id });

    await db.insert(recipeTags).values({ recipeId, tagId: tag.id, order: 0 });
  }

  async function rate(recipeId: string, userId: string, rating: number): Promise<void> {
    const db = getTestDb();

    await db.insert(recipeRatings).values({ recipeId, userId, rating });
  }

  function ctxFor(activeHouseholdId: string | null, memberHouseholdIds: string[]): RecipeListContext {
    return {
      userId: userU,
      householdUserIds: null,
      activeHouseholdId,
      memberHouseholdIds,
      isServerAdmin: false,
    };
  }

  it("U active on A gets A's recipes as candidates but NOT B's", async () => {
    const recipeA = await insertRecipe({ name: "A dinner", userId: userU, householdId: cookbookA });
    const recipeB = await insertRecipe({ name: "B dinner", userId: userV, householdId: cookbookB });

    const candidates = await getDinnerSuggestionCandidates(ctxFor(cookbookA, [cookbookA]));
    const ids = candidates.map((c) => c.id);

    expect(ids).toContain(recipeA);
    expect(ids).not.toContain(recipeB);
  });

  it("carries the recipe's own tags and a household-scoped rating aggregate", async () => {
    const recipeA = await insertRecipe({ name: "Rated A", userId: userU, householdId: cookbookA });

    await attachTag(recipeA, "BBQ");
    await rate(recipeA, userU, 5);

    const candidates = await getDinnerSuggestionCandidates(ctxFor(cookbookA, [cookbookA]));
    const found = candidates.find((c) => c.id === recipeA);

    expect(found?.tags).toContain("BBQ");
    expect(found?.householdAverageRating).toBe(5);
    expect(found?.householdRatingCount).toBe(1);
    expect(found?.lastRatedAt).toBeInstanceOf(Date);
  });

  it("another user's personal recipe is never a candidate", async () => {
    const personalV = await insertRecipe({ name: "V personal", userId: userV, householdId: null });

    const onA = await getDinnerSuggestionCandidates(ctxFor(cookbookA, [cookbookA]));
    const onPersonal = await getDinnerSuggestionCandidates(ctxFor(null, [cookbookA]));

    expect(onA.map((c) => c.id)).not.toContain(personalV);
    expect(onPersonal.map((c) => c.id)).not.toContain(personalV);
  });

  /**
   * The LIVE server policy. The tests above seed `view: "household"`; production
   * runs `{"view":"everyone",...}`. Per the AGENTS.md rule, any test that seeds a
   * policy needs an `everyone` sibling — the branch that caught the Phase 22
   * family. The candidate query must NOT widen across cookbooks under `everyone`.
   */
  describe("under the live server policy (view: everyone)", () => {
    beforeEach(async () => {
      await setConfig(
        ServerConfigKeys.RECIPE_PERMISSION_POLICY,
        { view: "everyone", edit: "household", delete: "household" },
        null
      );
    });

    it("active on A: still excludes B's recipes", async () => {
      const recipeA = await insertRecipe({ name: "A dinner", userId: userU, householdId: cookbookA });
      const recipeB = await insertRecipe({ name: "B dinner", userId: userV, householdId: cookbookB });

      const candidates = await getDinnerSuggestionCandidates(ctxFor(cookbookA, [cookbookA]));
      const ids = candidates.map((c) => c.id);

      expect(ids).toContain(recipeA);
      expect(ids).not.toContain(recipeB);
    });

    it("personal view: excludes another cookbook's recipe and another user's personal recipe", async () => {
      const recipeB = await insertRecipe({ name: "B dinner", userId: userV, householdId: cookbookB });
      const personalV = await insertRecipe({ name: "V personal", userId: userV, householdId: null });

      const candidates = await getDinnerSuggestionCandidates(ctxFor(null, [cookbookA]));
      const ids = candidates.map((c) => c.id);

      expect(ids).not.toContain(recipeB);
      expect(ids).not.toContain(personalV);
    });

    it("personal view: still surfaces the viewer's own recipes and orphans", async () => {
      const personalU = await insertRecipe({ name: "U personal", userId: userU, householdId: null });
      const orphan = await insertRecipe({ name: "Orphan", userId: null, householdId: null });

      const candidates = await getDinnerSuggestionCandidates(ctxFor(null, [cookbookA]));
      const ids = candidates.map((c) => c.id);

      expect(ids).toContain(personalU);
      expect(ids).toContain(orphan);
    });
  });
});
