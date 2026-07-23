// @vitest-environment node
/**
 * Shopping-list household isolation tests (SHOP-02 / HOUSE-06, security-critical).
 *
 * After the migration `0040` re-key, the shopping list (`groceries`, `stores`,
 * `ingredient_store_preferences`, `recurring_groceries`) is scoped by
 * `household_id`. These tests prove that a member of household A can read/modify
 * A's list but NEVER household B's, and that the scoping is POLICY-INDEPENDENT:
 * unlike recipes, the shopping list does not consult the recipe
 * `view` policy, so setting the server-wide policy to the live `everyone` value
 * (the `everyone` sibling required by AGENTS.md) must NOT widen the boundary.
 *
 * They also cover SHOP-01: `seedDefaultAislesForHousehold` seeds the built-in
 * aisles + ingredient->aisle mapping (idempotently) so a fresh household groups
 * with zero config.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addUserToHousehold,
  createHousehold,
  getGroceryHouseholdIds,
  listGroceriesByHousehold,
  setConfig,
} from "@norish/db";
import {
  getRecurringGroceryHouseholdId,
  listRecurringGroceriesByHousehold,
} from "@norish/db/repositories/recurring-groceries";
import {
  findBestIngredientStorePreference,
  getStoreHouseholdId,
  listIngredientStorePreferencesByHousehold,
  listStoresByHousehold,
  seedDefaultAislesForHousehold,
} from "@norish/db/repositories/stores";
import { ServerConfigKeys } from "@norish/config/zod/server-config";
import { groceries, recurringGroceries, stores } from "@norish/db/schema";

import { createTestUser, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

describe("shopping-list household isolation (SHOP-02 / HOUSE-06)", () => {
  const testBase = new RepositoryTestBase("shopping_list_isolation");

  let userU: string; // member of household A only
  let userV: string; // member of household B only
  let householdA: string;
  let householdB: string;

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

    const hA = await createHousehold({ name: "Household A", adminUserId: userU });
    const hB = await createHousehold({ name: "Household B", adminUserId: userV });

    householdA = hA.id;
    householdB = hB.id;

    await addUserToHousehold({ householdId: householdA, userId: userU });
    await addUserToHousehold({ householdId: householdB, userId: userV });

    // Baseline: the per-cookbook "household" policy (isolation is policy-independent
    // for the shopping list, but seed the sane default here; the `everyone` sibling
    // is asserted explicitly below).
    await setConfig(
      ServerConfigKeys.RECIPE_PERMISSION_POLICY,
      { view: "household", edit: "household", delete: "household" },
      null
    );
  });

  async function addGrocery(householdId: string, userId: string, name: string): Promise<string> {
    const db = getTestDb();
    const [row] = await db
      .insert(groceries)
      .values({ householdId, userId, name, isDone: false, sortOrder: 0 })
      .returning();

    return row!.id;
  }

  async function addRecurring(householdId: string, userId: string, name: string): Promise<string> {
    const db = getTestDb();
    const [row] = await db
      .insert(recurringGroceries)
      .values({
        householdId,
        userId,
        name,
        recurrenceRule: "week",
        recurrenceInterval: 1,
        nextPlannedFor: "2026-01-01",
      })
      .returning();

    return row!.id;
  }

  it("lists only the caller's household groceries — never the other household's", async () => {
    const aId = await addGrocery(householdA, userU, "A-milk");
    const bId = await addGrocery(householdB, userV, "B-bread");

    const aList = await listGroceriesByHousehold(householdA);
    const bList = await listGroceriesByHousehold(householdB);

    expect(aList.map((g) => g.id)).toContain(aId);
    expect(aList.map((g) => g.id)).not.toContain(bId);
    expect(bList.map((g) => g.id)).toContain(bId);
    expect(bList.map((g) => g.id)).not.toContain(aId);
  });

  it("getGroceryHouseholdIds returns the OWNING household (the isolation gate input)", async () => {
    const aId = await addGrocery(householdA, userU, "A-eggs");
    const bId = await addGrocery(householdB, userV, "B-eggs");

    const map = await getGroceryHouseholdIds([aId, bId]);

    expect(map.get(aId)).toBe(householdA);
    expect(map.get(bId)).toBe(householdB);
    // A caller scoped to household A would reject bId because it !== householdA.
    expect(map.get(bId)).not.toBe(householdA);
  });

  it("stores + aisle preferences + recurring groceries are household-scoped", async () => {
    const db = getTestDb();
    const [storeA] = await db
      .insert(stores)
      .values({ householdId: householdA, userId: userU, name: "A-aisle" })
      .returning();
    const [storeB] = await db
      .insert(stores)
      .values({ householdId: householdB, userId: userV, name: "B-aisle" })
      .returning();

    const aStores = await listStoresByHousehold(householdA);
    const bStores = await listStoresByHousehold(householdB);

    expect(aStores.every((s) => s.name !== "B-aisle")).toBe(true);
    expect(bStores.every((s) => s.name !== "A-aisle")).toBe(true);
    // Every store returned for A truly belongs to A.
    for (const s of aStores) {
      expect(await getStoreHouseholdId(s.id)).toBe(householdA);
    }

    expect(await getStoreHouseholdId(storeB!.id)).toBe(householdB);
    expect(await getStoreHouseholdId(storeA!.id)).toBe(householdA);

    const rA = await addRecurring(householdA, userU, "A-weekly");
    const rB = await addRecurring(householdB, userV, "B-weekly");

    expect((await listRecurringGroceriesByHousehold(householdA)).map((r) => r.id)).toContain(rA);
    expect((await listRecurringGroceriesByHousehold(householdA)).map((r) => r.id)).not.toContain(
      rB
    );
    expect(await getRecurringGroceryHouseholdId(rB)).toBe(householdB);
  });

  it("`everyone` sibling: the live server-wide policy does NOT widen the shopping list", async () => {
    const aId = await addGrocery(householdA, userU, "A-secret");
    const bId = await addGrocery(householdB, userV, "B-secret");

    // Seed the LIVE production policy value.
    await setConfig(
      ServerConfigKeys.RECIPE_PERMISSION_POLICY,
      { view: "everyone", edit: "household", delete: "household" },
      null
    );

    // The shopping list must stay strictly household-scoped regardless of the
    // recipe view policy — it never branches on `everyone`.
    const aList = await listGroceriesByHousehold(householdA);

    expect(aList.map((g) => g.id)).toContain(aId);
    expect(aList.map((g) => g.id)).not.toContain(bId);

    const map = await getGroceryHouseholdIds([bId]);

    expect(map.get(bId)).toBe(householdB);
    expect(map.get(bId)).not.toBe(householdA);
  });

  it("SHOP-01: seeds default aisles + ingredient mapping, idempotently", async () => {
    // createHousehold already seeded householdA; a fresh household with no stores
    // is what seedDefaultAislesForHousehold targets, but re-running must be a no-op.
    const before = await listStoresByHousehold(householdA);

    expect(before.length).toBeGreaterThan(0); // seeded at createHousehold

    const prefs = await listIngredientStorePreferencesByHousehold(householdA);

    expect(prefs.length).toBeGreaterThan(0);

    // A common ingredient resolves to a seeded aisle (zero-config grouping).
    const match = await findBestIngredientStorePreference(householdA, "milk");

    expect(match).not.toBeNull();
    expect(before.map((s) => s.id)).toContain(match!.preference.storeId);

    // Idempotent: a second seed leaves counts unchanged.
    await seedDefaultAislesForHousehold(householdA, userU);
    const after = await listStoresByHousehold(householdA);

    expect(after.length).toBe(before.length);
  });
});
