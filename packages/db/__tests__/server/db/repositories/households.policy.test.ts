// @vitest-environment node
/**
 * Per-cookbook recipe permission policy tests (POLICY-01), exercised against a
 * REAL Postgres testcontainer (the 02-06 lesson: a createSelectSchema-derived
 * DTO must parse a real row including the new enum columns; trpc/zod mocks miss
 * real-row-vs-zod mismatches).
 *
 * Covers: getHouseholdPolicy / setHouseholdPolicy (admin-only, optimistic
 * version, decision #5 view!=everyone), createHousehold seeding the policy
 * columns, the real-parse of HouseholdSelectBaseSchema, and the
 * buildViewPolicyCondition SOURCE swap (the list reads the ACTIVE cookbook's
 * view_policy column — proven by setting cookbook A to view=owner and confirming
 * a member no longer sees another member's recipe in A).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  addUserToHousehold,
  createHousehold,
  getHouseholdById,
  getHouseholdPolicy,
  listRecipes,
  setHouseholdPolicy,
} from "@norish/db";
import { HouseholdSelectBaseSchema } from "@norish/shared/contracts/zod/household";
import { recipes } from "@norish/db/schema";

import { createTestUser, getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

describe("per-cookbook recipe permission policy (POLICY-01)", () => {
  const testBase = new RepositoryTestBase("household_policy");

  let adminUser: string;
  let memberUser: string;
  let cookbookA: string;

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    adminUser = user.id;

    const other = await createTestUser();

    memberUser = other.id;

    const household = await createHousehold({ name: "Cookbook A", adminUserId: adminUser });

    cookbookA = household.id;

    await addUserToHousehold({ householdId: cookbookA, userId: adminUser });
    await addUserToHousehold({ householdId: cookbookA, userId: memberUser });
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

  describe("createHousehold seeds the policy columns + real-parse", () => {
    it("a created household row parses through HouseholdSelectBaseSchema WITH the enum columns", async () => {
      // getHouseholdById does a SELECT * + HouseholdSelectBaseSchema.safeParse;
      // it returns null on a parse failure, so a non-null result proves the real
      // row (incl. view_policy/edit_policy/delete_policy) matches the zod schema.
      const fetched = await getHouseholdById(cookbookA);

      expect(fetched).not.toBeNull();
      expect(fetched!.viewPolicy).toBe("everyone");
      expect(fetched!.editPolicy).toBe("household");
      expect(fetched!.deletePolicy).toBe("household");

      // Re-parse the raw row explicitly to be unambiguous about the real-parse.
      const db = getTestDb();
      const [raw] = await db.query.households.findMany({ limit: 1 });
      const parsed = HouseholdSelectBaseSchema.safeParse(raw);

      expect(parsed.success).toBe(true);
    });
  });

  describe("getHouseholdPolicy", () => {
    it("returns the cookbook's policy + admin", async () => {
      const result = await getHouseholdPolicy(cookbookA);

      expect(result).not.toBeNull();
      expect(result!.adminUserId).toBe(adminUser);
      expect(result!.policy).toEqual({ view: "everyone", edit: "household", delete: "household" });
    });

    it("returns null for a non-existent household", async () => {
      expect(await getHouseholdPolicy("00000000-0000-0000-0000-000000000000")).toBeNull();
    });
  });

  describe("setHouseholdPolicy (admin-only, optimistic version, decision #5)", () => {
    it("the admin can set a valid policy; getHouseholdPolicy reflects it", async () => {
      const before = await getHouseholdById(cookbookA);
      const result = await setHouseholdPolicy(
        cookbookA,
        adminUser,
        { view: "household", edit: "owner", delete: "owner" },
        before!.version
      );

      expect(result.stale).toBeFalsy();

      const after = await getHouseholdPolicy(cookbookA);

      expect(after!.policy).toEqual({ view: "household", edit: "owner", delete: "owner" });
    });

    it("a non-admin member is FORBIDDEN", async () => {
      const before = await getHouseholdById(cookbookA);

      await expect(
        setHouseholdPolicy(cookbookA, memberUser, { view: "household", edit: "household", delete: "household" }, before!.version)
      ).rejects.toThrow("FORBIDDEN");
    });

    it("rejects a per-cookbook view=everyone (decision #5)", async () => {
      const before = await getHouseholdById(cookbookA);

      await expect(
        // @ts-expect-error — deliberately bypassing the input schema to prove the
        // repo re-asserts decision #5 even if a caller skips validation.
        setHouseholdPolicy(cookbookA, adminUser, { view: "everyone", edit: "household", delete: "household" }, before!.version)
      ).rejects.toThrow("Invalid household policy");
    });

    it("a stale version is a no-op (stale outcome)", async () => {
      const result = await setHouseholdPolicy(
        cookbookA,
        adminUser,
        { view: "household", edit: "household", delete: "household" },
        999
      );

      expect(result.stale).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // buildViewPolicyCondition SOURCE SWAP: the active-cookbook list reads THAT
  // cookbook's view_policy column (not the global config row).
  // ---------------------------------------------------------------------------
  describe("list scoping reads the ACTIVE cookbook's view_policy", () => {
    function ctxFor(userId: string) {
      return {
        userId,
        householdUserIds: null,
        activeHouseholdId: cookbookA,
        memberHouseholdIds: [cookbookA],
        isServerAdmin: false,
      };
    }

    it("view=household: a member sees ALL of the active cookbook's recipes", async () => {
      const before = await getHouseholdById(cookbookA);

      await setHouseholdPolicy(cookbookA, adminUser, { view: "household", edit: "household", delete: "household" }, before!.version);

      const adminsRecipe = await insertRecipe({ name: "admin recipe", userId: adminUser, householdId: cookbookA });
      const membersRecipe = await insertRecipe({ name: "member recipe", userId: memberUser, householdId: cookbookA });

      const { recipes: visible } = await listRecipes(ctxFor(memberUser), 100);
      const ids = visible.map((r) => r.id);

      expect(ids).toContain(adminsRecipe);
      expect(ids).toContain(membersRecipe);
    });

    it("view=owner: a member sees ONLY their OWN recipe in the active cookbook (source swap proof)", async () => {
      const before = await getHouseholdById(cookbookA);

      await setHouseholdPolicy(cookbookA, adminUser, { view: "owner", edit: "household", delete: "household" }, before!.version);

      const adminsRecipe = await insertRecipe({ name: "admin recipe", userId: adminUser, householdId: cookbookA });
      const membersRecipe = await insertRecipe({ name: "member recipe", userId: memberUser, householdId: cookbookA });

      const { recipes: visible } = await listRecipes(ctxFor(memberUser), 100);
      const ids = visible.map((r) => r.id);

      // Under the cookbook's OWN view=owner, the member sees their own recipe but
      // NOT the admin's — proving the list reads the cookbook column, not global.
      expect(ids).toContain(membersRecipe);
      expect(ids).not.toContain(adminsRecipe);
    });
  });
});
