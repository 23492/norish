import { describe, expect, it, vi } from "vitest";

import { canAccessHouseholdResource, canAccessResource } from "@norish/auth/permissions";

// Mock getConfig to return test policies
vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: vi.fn().mockResolvedValue({
    view: "household",
    edit: "household",
    delete: "owner",
  }),
}));

// Mock getHouseholdForUser
vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn().mockImplementation((userId: string) => {
    // Simulate user1 and user2 being in the same household
    if (userId === "user1" || userId === "user2") {
      return Promise.resolve({
        id: "household1",
        users: [{ id: "user1" }, { id: "user2" }],
      });
    }

    // user3 has no household
    return Promise.resolve(null);
  }),
}));

describe("canAccessResource", () => {
  const user1 = "user1";
  const user2 = "user2";
  const user3 = "user3";
  // The cookbook (household) the recipe belongs to, and the requester's member set.
  const cookbookA = "household1";
  const memberOfA = ["household1"];

  describe("owner access", () => {
    it("owner can always view their own resource", async () => {
      const result = await canAccessResource("view", user1, user1, null, [], false);

      expect(result).toBe(true);
    });

    it("owner can always edit their own resource", async () => {
      const result = await canAccessResource("edit", user1, user1, null, [], false);

      expect(result).toBe(true);
    });

    it("owner can always delete their own resource", async () => {
      const result = await canAccessResource("delete", user1, user1, null, [], false);

      expect(result).toBe(true);
    });
  });

  describe("server admin access", () => {
    it("server admin can view any resource", async () => {
      const result = await canAccessResource("view", user3, user1, cookbookA, [], true);

      expect(result).toBe(true);
    });

    it("server admin can edit any resource", async () => {
      const result = await canAccessResource("edit", user3, user1, cookbookA, [], true);

      expect(result).toBe(true);
    });

    it("server admin can delete any resource", async () => {
      const result = await canAccessResource("delete", user3, user1, cookbookA, [], true);

      expect(result).toBe(true);
    });
  });

  describe("household (per-cookbook) access with policy", () => {
    it("member of the recipe's cookbook can view when policy is 'household'", async () => {
      const result = await canAccessResource("view", user2, user1, cookbookA, memberOfA, false);

      expect(result).toBe(true);
    });

    it("member of the recipe's cookbook can edit when policy is 'household'", async () => {
      const result = await canAccessResource("edit", user2, user1, cookbookA, memberOfA, false);

      expect(result).toBe(true);
    });

    it("member of the recipe's cookbook cannot delete when policy is 'owner'", async () => {
      const result = await canAccessResource("delete", user2, user1, cookbookA, memberOfA, false);

      expect(result).toBe(false);
    });

    it("non-member of the recipe's cookbook cannot view", async () => {
      // Requester is a member of a DIFFERENT cookbook, not the recipe's.
      const result = await canAccessResource("view", user3, user1, cookbookA, ["household2"], false);

      expect(result).toBe(false);
    });

    it("a personal recipe (null household) is not viewable by non-owners under 'household'", async () => {
      const result = await canAccessResource("view", user2, user1, null, memberOfA, false);

      expect(result).toBe(false);
    });
  });
});

describe("canAccessHouseholdResource", () => {
  it("owner always has access", async () => {
    const result = await canAccessHouseholdResource("user1", "user1");

    expect(result).toBe(true);
  });

  it("household member has access to other member's resource", async () => {
    const result = await canAccessHouseholdResource("user1", "user2");

    expect(result).toBe(true);
  });

  it("non-household member does not have access", async () => {
    const result = await canAccessHouseholdResource("user3", "user1");

    expect(result).toBe(false);
  });
});
