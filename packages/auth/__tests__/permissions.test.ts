import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";

import { describe, expect, it, vi } from "vitest";

import { canAccessHouseholdResource, canAccessResource } from "@norish/auth/permissions";

// Mock getHouseholdForUser (used only by canAccessHouseholdResource — the
// groceries/calendar member-overlap gate, unchanged by POLICY-01).
vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn().mockImplementation((userId: string) => {
    if (userId === "user1" || userId === "user2") {
      return Promise.resolve({
        id: "household1",
        users: [{ id: "user1" }, { id: "user2" }],
      });
    }

    return Promise.resolve(null);
  }),
  // resolveRecipeCookbookPolicy is exercised via canAccessResource's args here,
  // so getHouseholdPolicy is not called in these unit tests; stub for the graph.
  getHouseholdPolicy: vi.fn(),
}));

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: vi.fn(),
}));

function policy(p: Partial<RecipePermissionPolicy>): RecipePermissionPolicy {
  return {
    view: p.view ?? "everyone",
    edit: p.edit ?? "household",
    delete: p.delete ?? "household",
  };
}

describe("canAccessResource (per-cookbook policy + admin-or-owner)", () => {
  const owner = "owner-id";
  const member = "member-id"; // a non-admin, non-owner member of the recipe's cookbook
  const admin = "admin-id"; // the recipe's cookbook admin
  const stranger = "stranger-id"; // not a member of the recipe's cookbook
  const cookbookA = "cookbook-A";
  const memberOfA = [cookbookA];

  describe("owner / server-admin short-circuit", () => {
    it.each(["view", "edit", "delete"] as const)(
      "the recipe owner can always %s their own recipe regardless of policy",
      (action) => {
        expect(
          canAccessResource(action, owner, owner, cookbookA, [], false, policy({ view: "owner", edit: "owner", delete: "owner" }), admin)
        ).toBe(true);
      }
    );

    it.each(["view", "edit", "delete"] as const)(
      "a server admin can %s any recipe",
      (action) => {
        expect(
          canAccessResource(action, stranger, owner, cookbookA, [], true, policy({ view: "owner", edit: "owner", delete: "owner" }), admin)
        ).toBe(true);
      }
    );
  });

  describe("view = household: any member of the recipe's cookbook", () => {
    it("a member of the recipe's cookbook can view it", () => {
      expect(
        canAccessResource("view", member, owner, cookbookA, memberOfA, false, policy({ view: "household" }), admin)
      ).toBe(true);
    });

    it("a NON-member cannot view it (even though policy is household)", () => {
      expect(
        canAccessResource("view", stranger, owner, cookbookA, ["cookbook-B"], false, policy({ view: "household" }), admin)
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // DECISION #3 (admin-edits-any / members-edit-own): edit/delete = household
  // means OWNER or cookbook ADMIN — a non-admin member cannot edit OTHERS'.
  // ---------------------------------------------------------------------------
  describe("edit/delete = household: owner OR cookbook admin only", () => {
    it.each(["edit", "delete"] as const)(
      "the cookbook ADMIN can %s another member's recipe",
      (action) => {
        // admin is a member of A and is the cookbook admin; not the owner.
        expect(
          canAccessResource(action, admin, owner, cookbookA, memberOfA, false, policy({ edit: "household", delete: "household" }), admin)
        ).toBe(true);
      }
    );

    it.each(["edit", "delete"] as const)(
      "a non-admin MEMBER cannot %s another member's recipe",
      (action) => {
        // member is in cookbook A but is neither the owner nor the admin.
        expect(
          canAccessResource(action, member, owner, cookbookA, memberOfA, false, policy({ edit: "household", delete: "household" }), admin)
        ).toBe(false);
      }
    );

    it.each(["edit", "delete"] as const)(
      "the OWNER can %s their own recipe (members-edit-own)",
      (action) => {
        expect(
          canAccessResource(action, owner, owner, cookbookA, memberOfA, false, policy({ edit: "household", delete: "household" }), admin)
        ).toBe(true);
      }
    );
  });

  describe("owner-level + everyone", () => {
    it("owner-level delete hides from a non-owner member", () => {
      expect(
        canAccessResource("delete", member, owner, cookbookA, memberOfA, false, policy({ delete: "owner" }), admin)
      ).toBe(false);
    });

    it("everyone-level view allows any user", () => {
      expect(
        canAccessResource("view", stranger, owner, cookbookA, [], false, policy({ view: "everyone" }), admin)
      ).toBe(true);
    });
  });

  describe("personal recipe (null household) is owner-only under household", () => {
    it.each(["view", "edit", "delete"] as const)(
      "a non-owner cannot %s a personal recipe when policy is household (null admin)",
      (action) => {
        expect(
          canAccessResource(action, member, owner, null, memberOfA, false, policy({ view: "household", edit: "household", delete: "household" }), null)
        ).toBe(false);
      }
    );
  });

  // ---------------------------------------------------------------------------
  // SECURITY-CRITICAL (HOUSE-06): a non-member NEVER gets access to another
  // cookbook's recipe, under EVERY policy combination on that cookbook.
  // ---------------------------------------------------------------------------
  describe("cross-cookbook isolation under every policy combo (HOUSE-06)", () => {
    const levels = ["everyone", "household", "owner"] as const;

    // A stranger is a member of cookbook B only; the recipe lives in cookbook A.
    // For edit/delete, isolation must hold for EVERY level except where the
    // policy is `everyone` (an explicit, admin-chosen instance-wide grant). The
    // ONLY widening is `everyone` — `household`/`owner` never reach a non-member.
    for (const view of levels) {
      for (const edit of levels) {
        for (const del of levels) {
          it(`stranger (member of B) blocked on A's recipe for view=${view} edit=${edit} delete=${del} unless everyone`, () => {
            const p = policy({ view, edit, delete: del });
            const ctxMemberOfB = ["cookbook-B"];

            expect(canAccessResource("view", stranger, owner, cookbookA, ctxMemberOfB, false, p, admin)).toBe(
              view === "everyone"
            );
            expect(canAccessResource("edit", stranger, owner, cookbookA, ctxMemberOfB, false, p, admin)).toBe(
              edit === "everyone"
            );
            expect(canAccessResource("delete", stranger, owner, cookbookA, ctxMemberOfB, false, p, admin)).toBe(
              del === "everyone"
            );
          });
        }
      }
    }
  });
});

describe("canAccessHouseholdResource", () => {
  it("owner always has access", async () => {
    expect(await canAccessHouseholdResource("user1", "user1")).toBe(true);
  });

  it("household member has access to other member's resource", async () => {
    expect(await canAccessHouseholdResource("user1", "user2")).toBe(true);
  });

  it("non-household member does not have access", async () => {
    expect(await canAccessHouseholdResource("user3", "user1")).toBe(false);
  });
});
