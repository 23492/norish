// @vitest-environment node
/**
 * Cross-cookbook isolation tests (HOUSE-06, security-critical).
 *
 * These exercise the DB-level recipe scoping (listRecipes / buildViewPolicyCondition)
 * and per-cookbook dedup (recipeExistsByUrlForPolicy) to prove that a user who is a
 * member of cookbook A can never see/dedup against cookbook B's recipes, regardless
 * of the active selection — and that personal (household_id NULL) recipes stay
 * owner-only while orphans (userId NULL) remain public.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { RecipeListContext } from "@norish/db/repositories/recipes";
import {
  addUserToHousehold,
  createHousehold,
  listRecipes,
  recipeExistsByUrlForPolicy,
  setConfig,
} from "@norish/db";
import { ServerConfigKeys } from "@norish/config/zod/server-config";
import { recipes } from "@norish/db/schema";

import { createTestUser, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

describe("cross-cookbook recipe isolation (HOUSE-06)", () => {
  const testBase = new RepositoryTestBase("household_isolation");

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
    // Cleans the DB and gives us a base user (reused as U) — mirror versioning.test.ts.
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

    // The per-cookbook boundary is only meaningful under the "household" view policy.
    await setConfig(
      ServerConfigKeys.RECIPE_PERMISSION_POLICY,
      { view: "household", edit: "household", delete: "household" },
      null
    );
  });

  /** Insert a recipe straight into the table with an explicit cookbook + owner. */
  async function insertRecipe(opts: {
    name: string;
    url?: string | null;
    userId: string | null;
    householdId: string | null;
  }): Promise<string> {
    const db = getTestDb();
    const [row] = await db
      .insert(recipes)
      .values({
        name: opts.name,
        url: opts.url ?? null,
        userId: opts.userId,
        householdId: opts.householdId,
        servings: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: recipes.id });

    return row.id;
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

  it("U active on A sees A's recipes but NOT B's", async () => {
    const recipeA = await insertRecipe({ name: "Recipe in A", userId: userU, householdId: cookbookA });
    const recipeB = await insertRecipe({ name: "Recipe in B", userId: userV, householdId: cookbookB });

    const { recipes: visible } = await listRecipes(ctxFor(cookbookA, [cookbookA]), 100);
    const ids = visible.map((r) => r.id);

    expect(ids).toContain(recipeA);
    expect(ids).not.toContain(recipeB);
  });

  it("U active on A cannot see B's recipes even though cookbook B exists", async () => {
    const recipeB = await insertRecipe({ name: "B only", userId: userV, householdId: cookbookB });

    const { recipes: visible } = await listRecipes(ctxFor(cookbookA, [cookbookA]), 100);

    expect(visible.map((r) => r.id)).not.toContain(recipeB);
  });

  it("a personal recipe (household_id NULL) of another user is invisible to U", async () => {
    const personalV = await insertRecipe({ name: "V personal", userId: userV, householdId: null });

    const onA = await listRecipes(ctxFor(cookbookA, [cookbookA]), 100);
    const onPersonal = await listRecipes(ctxFor(null, [cookbookA]), 100);

    expect(onA.recipes.map((r) => r.id)).not.toContain(personalV);
    expect(onPersonal.recipes.map((r) => r.id)).not.toContain(personalV);
  });

  it("U's OWN personal recipe is visible in personal view (activeHouseholdId null)", async () => {
    const personalU = await insertRecipe({ name: "U personal", userId: userU, householdId: null });

    const { recipes: visible } = await listRecipes(ctxFor(null, [cookbookA]), 100);

    expect(visible.map((r) => r.id)).toContain(personalU);
  });

  it("an orphan recipe (userId NULL) is visible to everyone", async () => {
    const orphan = await insertRecipe({ name: "Orphan", userId: null, householdId: null });

    const onA = await listRecipes(ctxFor(cookbookA, [cookbookA]), 100);
    const onPersonal = await listRecipes(ctxFor(null, [cookbookA]), 100);

    expect(onA.recipes.map((r) => r.id)).toContain(orphan);
    expect(onPersonal.recipes.map((r) => r.id)).toContain(orphan);
  });

  it("dedup is per-cookbook: a recipe living in A does not match a dedup check for B", async () => {
    const url = "https://example.com/shared-recipe";

    await insertRecipe({ name: "Shared URL in A", url, userId: userU, householdId: cookbookA });

    // V imports the same URL into cookbook B -> must NOT be deduped against A's copy.
    const inB = await recipeExistsByUrlForPolicy(url, userV, cookbookB, [userV], "household");

    expect(inB.exists).toBe(false);

    // Sanity: the same URL IS found within cookbook A.
    const inA = await recipeExistsByUrlForPolicy(url, userU, cookbookA, [userU], "household");

    expect(inA.exists).toBe(true);
  });

  /**
   * LIST-ISO-01 — the personal view under the LIVE server policy.
   *
   * The tests above seed `view: "household"` because "the per-cookbook boundary is only
   * meaningful under the household view policy". But production runs
   * `{"view":"everyone",...}`, and in the personal view (no active cookbook)
   * `buildViewPolicyCondition` answers `everyone` with NO where-clause at all. That branch
   * has therefore never been exercised, which is the same shape as Phase 22 / 22.1: the
   * invariant was proven under a config live does not have.
   *
   * The personal view is reachable by any authenticated user — `households.switchActive`
   * accepts `{ householdId: null }`.
   */
  describe("personal view under the live server policy (view: everyone)", () => {
    beforeEach(async () => {
      await setConfig(
        ServerConfigKeys.RECIPE_PERMISSION_POLICY,
        { view: "everyone", edit: "household", delete: "household" },
        null
      );
    });

    it("does not expose another cookbook's recipes", async () => {
      const recipeB = await insertRecipe({
        name: "Recipe in B",
        userId: userV,
        householdId: cookbookB,
      });

      const { recipes: visible } = await listRecipes(ctxFor(null, [cookbookA]), 100);

      expect(visible.map((r) => r.id)).not.toContain(recipeB);
    });

    it("does not expose another user's personal recipe", async () => {
      const personalV = await insertRecipe({ name: "V personal", userId: userV, householdId: null });

      const { recipes: visible } = await listRecipes(ctxFor(null, [cookbookA]), 100);

      expect(visible.map((r) => r.id)).not.toContain(personalV);
    });

    it("still shows the viewer's own recipes and orphans", async () => {
      const personalU = await insertRecipe({ name: "U personal", userId: userU, householdId: null });
      const inA = await insertRecipe({ name: "U in A", userId: userU, householdId: cookbookA });
      const orphan = await insertRecipe({ name: "Orphan", userId: null, householdId: null });

      const { recipes: visible } = await listRecipes(ctxFor(null, [cookbookA]), 100);
      const ids = visible.map((r) => r.id);

      expect(ids).toContain(personalU);
      expect(ids).toContain(inA);
      expect(ids).toContain(orphan);
    });
  });
});
