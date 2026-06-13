import type { RecipePermissionPolicy } from "@norish/config/zod/server-config";

import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveRecipeCookbookPolicy reads the recipe's OWN cookbook policy + admin
// from getHouseholdPolicy, and falls back to the global default (getConfig) for
// personal / missing cookbooks. Mock both deps and assert the keying.
const getHouseholdPolicyMock = vi.hoisted(() => vi.fn());
const getConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@norish/db/repositories/households", () => ({
  getHouseholdForUser: vi.fn(),
  getHouseholdPolicy: getHouseholdPolicyMock,
}));

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: getConfigMock,
}));

const { resolveRecipeCookbookPolicy } = await import("@norish/auth/permissions");

const globalDefault: RecipePermissionPolicy = { view: "everyone", edit: "household", delete: "household" };

describe("resolveRecipeCookbookPolicy (keyed off the recipe's OWN cookbook)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConfigMock.mockResolvedValue(globalDefault);
  });

  it("reads the policy + admin from the recipe's household", async () => {
    const cookbookPolicy: RecipePermissionPolicy = { view: "household", edit: "household", delete: "owner" };

    getHouseholdPolicyMock.mockResolvedValue({ policy: cookbookPolicy, adminUserId: "admin-A" });

    const resolved = await resolveRecipeCookbookPolicy("cookbook-A");

    expect(getHouseholdPolicyMock).toHaveBeenCalledWith("cookbook-A");
    expect(resolved.policy).toEqual(cookbookPolicy);
    expect(resolved.adminUserId).toBe("admin-A");
  });

  it("falls back to the global default + null admin for a PERSONAL recipe (null household)", async () => {
    const resolved = await resolveRecipeCookbookPolicy(null);

    expect(getHouseholdPolicyMock).not.toHaveBeenCalled();
    expect(resolved.policy).toEqual(globalDefault);
    expect(resolved.adminUserId).toBeNull();
  });

  it("falls back to the global default + null admin when the cookbook no longer exists (fail-safe)", async () => {
    getHouseholdPolicyMock.mockResolvedValue(null);

    const resolved = await resolveRecipeCookbookPolicy("ghost-cookbook");

    expect(resolved.policy).toEqual(globalDefault);
    expect(resolved.adminUserId).toBeNull();
  });
});
