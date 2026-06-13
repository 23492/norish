// @vitest-environment node
/**
 * Regression: invite-token column must not break the household resolver (02-06).
 *
 * Adding households.invite_token made createSelectSchema(households) require
 * inviteToken, so HouseholdWithUsersNamesSchema (= the resolver DTO schema used
 * by mapHouseholdRowToDto) started rejecting every real row — the mapper +
 * HOUSEHOLD_WITH_MEMBERS_QUERY do not select inviteToken — and every household
 * resolve threw "Failed to parse household for user". The trpc tests mock
 * @norish/db wholesale, so the real-row-vs-zod mismatch slipped through.
 *
 * These tests exercise the REAL resolver (getActiveHouseholdForUser /
 * getHouseholdsForUser -> mapHouseholdRowToDto) against a household row that
 * INCLUDES a non-null invite_token, and assert:
 *   1. the resolve succeeds (would have thrown before the fix), and
 *   2. the resolver DTO stays token-free (inviteToken must never ride the
 *      member-facing resolver shape).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";
import {
  addUserToHousehold,
  createHousehold,
  getActiveHouseholdForUser,
  getHouseholdsForUser,
  setActiveHousehold,
} from "@norish/db";
import { households } from "@norish/db/schema";

import { getTestDb } from "../../../helpers/db-test-helpers";
import { RepositoryTestBase } from "../../../helpers/repository-test-base";

describe("household resolver tolerates the invite_token column (02-06 regression)", () => {
  const testBase = new RepositoryTestBase("household_invite_token_resolver");

  let userId: string;
  let householdId: string;

  // A long, url-safe token shaped like a real one (32 bytes base64url ~= 43 chars).
  const INVITE_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRST012345";

  beforeAll(async () => {
    await testBase.setup();
  });

  afterAll(async () => {
    await testBase.teardown();
  });

  beforeEach(async () => {
    const [user] = await testBase.beforeEachTest();

    userId = user.id;

    const household = await createHousehold({ name: "Token Cookbook", adminUserId: userId });

    householdId = household.id;

    await addUserToHousehold({ householdId, userId });
    await setActiveHousehold(userId, householdId);

    // Persist a real invite token directly on the row (mirrors generateInviteToken).
    await getTestDb()
      .update(households)
      .set({ inviteToken: INVITE_TOKEN })
      .where(eq(households.id, householdId));
  });

  it("getActiveHouseholdForUser resolves a row that has an invite_token (no parse throw)", async () => {
    // Before the fix this threw "Failed to parse household for user".
    const resolved = await getActiveHouseholdForUser(userId);

    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(householdId);
    expect(resolved?.name).toBe("Token Cookbook");
    expect(resolved?.users.map((u) => u.id)).toContain(userId);
  });

  it("the resolver DTO stays token-free (inviteToken never on the member-facing shape)", async () => {
    const resolved = await getActiveHouseholdForUser(userId);

    // Hard leak guard: the admin-only token must not ride the resolver DTO.
    expect(resolved).not.toHaveProperty("inviteToken");
  });

  it("getHouseholdsForUser (switcher path) also resolves the token-bearing row", async () => {
    const memberships = await getHouseholdsForUser(userId);

    const target = memberships.find((h) => h.id === householdId);

    expect(target).toBeDefined();
    expect(target).not.toHaveProperty("inviteToken");
  });
});
