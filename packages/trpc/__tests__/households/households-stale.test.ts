// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trpcLogger } from "@norish/shared-server/logger";
import { householdsRouter } from "@norish/trpc/routers/households/households";

import {
  createMockAuthedContext,
  createMockHousehold,
  createMockUser,
} from "../calendar/test-utils";

const householdDb = vi.hoisted(() => ({
  addUserToHousehold: vi.fn(),
  createHousehold: vi.fn(),
  findHouseholdByJoinCode: vi.fn(),
  generateInviteToken: vi.fn(),
  getActiveHouseholdForUser: vi.fn(),
  getActiveHouseholdId: vi.fn(),
  getAllergiesForUsers: vi.fn(() => Promise.resolve([])),
  getHouseholdByInviteToken: vi.fn(),
  getHouseholdForUser: vi.fn(),
  getHouseholdsForUser: vi.fn(() => Promise.resolve([])),
  getInviteToken: vi.fn(() => Promise.resolve(null)),
  getUsersByHouseholdId: vi.fn(() => Promise.resolve([])),
  isUserHouseholdAdmin: vi.fn(),
  joinHouseholdByInviteToken: vi.fn(),
  kickUserFromHousehold: vi.fn(),
  regenerateJoinCode: vi.fn(),
  removeUserFromHousehold: vi.fn(),
  renameHousehold: vi.fn(),
  setActiveHousehold: vi.fn(),
  transferHouseholdAdmin: vi.fn(),
}));

const householdCache = vi.hoisted(() => ({
  invalidateHouseholdCache: vi.fn(),
  invalidateHouseholdCacheForUsers: vi.fn(),
}));

const householdEmitter = vi.hoisted(() => ({
  emitToHousehold: vi.fn(),
  emitToUser: vi.fn(),
}));

const permissionsEmitter = vi.hoisted(() => ({
  emitToUser: vi.fn(),
}));

const connectionManager = vi.hoisted(() => ({
  emitConnectionInvalidation: vi.fn(),
}));

vi.mock("@norish/db", () => householdDb);
vi.mock("@norish/db/cached-household", () => householdCache);
vi.mock("@norish/trpc/routers/households/emitter", () => ({ householdEmitter }));
vi.mock("@norish/trpc/routers/permissions/emitter", () => ({ permissionsEmitter }));
vi.mock("@norish/trpc/connection-manager", () => connectionManager);
vi.mock("@norish/config/server-config-loader", () => ({
  getRecipePermissionPolicy: vi.fn().mockResolvedValue({ view: "household" }),
}));
vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("household stale mutation handling", () => {
  const user = createMockUser({ id: crypto.randomUUID() });
  const adminUserId = crypto.randomUUID();
  const household = {
    ...createMockHousehold(),
    id: crypto.randomUUID(),
    adminUserId,
    users: [
      { id: user.id, name: user.name ?? "Test User", version: 3 },
      { id: adminUserId, name: "Household Member", version: 2 },
    ],
  } as any;
  const ctx = createMockAuthedContext(user, household);

  beforeEach(() => {
    vi.clearAllMocks();
    householdDb.getHouseholdForUser.mockResolvedValue({
      ...household,
      version: 3,
      users: [
        { id: user.id, name: user.name, version: 3 },
        { id: "household-member-id", name: "Household Member", version: 2 },
      ],
    });
    // Multi-membership: leave/kick resolve the SPECIFIC household via getHouseholdsForUser.
    householdDb.getHouseholdsForUser.mockResolvedValue([household]);
  });

  it("logs stale leave mutations as no-ops", async () => {
    householdDb.removeUserFromHousehold.mockResolvedValue({ stale: true });

    const caller = householdsRouter.createCaller({ ...ctx, multiplexer: null } as any);
    const result = await caller.leave({ householdId: household.id, version: 3 });

    expect(result).toEqual({ success: true });
    await Promise.resolve();

    expect(trpcLogger.info).toHaveBeenCalledWith(
      { userId: ctx.user.id, householdId: household.id, version: 3 },
      "Ignoring stale household leave mutation"
    );
    expect(connectionManager.emitConnectionInvalidation).not.toHaveBeenCalled();
    expect(householdEmitter.emitToUser).not.toHaveBeenCalled();
  });
});

describe("household invite token (INVITE-01)", () => {
  // A long, url-safe token that satisfies InviteTokenSchema (32-128 chars, [A-Za-z0-9_-]).
  const VALID_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRST012345";
  const user = createMockUser({ id: crypto.randomUUID() });
  const inviteHousehold = {
    ...createMockHousehold(),
    id: crypto.randomUUID(),
    name: "Friends Cookbook",
  } as any;
  const ctx = createMockAuthedContext(user, inviteHousehold);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getByInviteToken (PUBLIC, name-only)", () => {
    it("returns ONLY the cookbook name for a valid token (no members/recipes/ids)", async () => {
      householdDb.getHouseholdByInviteToken.mockResolvedValue({
        id: inviteHousehold.id,
        name: "Friends Cookbook",
      });

      // Public query — call without an authed context.
      const caller = householdsRouter.createCaller({ user: null, multiplexer: null } as any);
      const result = await caller.getByInviteToken({ token: VALID_TOKEN });

      expect(result).toEqual({ name: "Friends Cookbook" });
      // Hard assertion: the public payload exposes the name ONLY.
      expect(Object.keys(result ?? {})).toEqual(["name"]);
      expect(result).not.toHaveProperty("id");
      expect(result).not.toHaveProperty("users");
      expect(householdDb.getHouseholdByInviteToken).toHaveBeenCalledWith(VALID_TOKEN);
    });

    it("returns null for an invalid/revoked token (no error, no leak)", async () => {
      householdDb.getHouseholdByInviteToken.mockResolvedValue(null);

      const caller = householdsRouter.createCaller({ user: null, multiplexer: null } as any);
      const result = await caller.getByInviteToken({ token: VALID_TOKEN });

      expect(result).toBeNull();
    });
  });

  describe("joinByInviteToken (authed, multi-membership)", () => {
    it("reuses the multi-membership join path and sets the cookbook active", async () => {
      householdDb.getHouseholdByInviteToken.mockResolvedValue({
        id: inviteHousehold.id,
        name: "Friends Cookbook",
      });
      householdDb.getUsersByHouseholdId.mockResolvedValue([{ userId: "existing-member" }]);
      householdDb.joinHouseholdByInviteToken.mockResolvedValue({
        householdId: inviteHousehold.id,
        userId: user.id,
        version: 1,
      });
      householdDb.getActiveHouseholdForUser.mockResolvedValue({
        ...inviteHousehold,
        version: 1,
        adminUserId: "existing-member",
        users: [{ id: user.id, name: user.name, version: 1 }],
      });

      const caller = householdsRouter.createCaller({ ...ctx, multiplexer: null } as any);
      const result = await caller.joinByInviteToken({ token: VALID_TOKEN });

      expect(result).toEqual({ householdId: inviteHousehold.id });
      // Reuses the SAME multi-membership join path as join-by-code...
      expect(householdDb.joinHouseholdByInviteToken).toHaveBeenCalledWith(VALID_TOKEN, user.id);
      // ...and makes the joined cookbook active (does NOT block on existing membership).
      expect(householdDb.setActiveHousehold).toHaveBeenCalledWith(user.id, inviteHousehold.id);
      expect(connectionManager.emitConnectionInvalidation).toHaveBeenCalledWith(
        user.id,
        "household-joined"
      );
    });

    it("throws NOT_FOUND for an invalid token (no join attempted)", async () => {
      householdDb.getHouseholdByInviteToken.mockResolvedValue(null);

      const caller = householdsRouter.createCaller({ ...ctx, multiplexer: null } as any);

      await expect(caller.joinByInviteToken({ token: VALID_TOKEN })).rejects.toThrow(
        "This invite link is no longer valid"
      );
      expect(householdDb.joinHouseholdByInviteToken).not.toHaveBeenCalled();
      expect(householdDb.setActiveHousehold).not.toHaveBeenCalled();
    });
  });

  describe("generateInviteToken (admin-only)", () => {
    it("returns the generated token for an admin", async () => {
      householdDb.isUserHouseholdAdmin.mockResolvedValue(true);
      householdDb.generateInviteToken.mockResolvedValue(VALID_TOKEN);
      householdDb.getUsersByHouseholdId.mockResolvedValue([{ userId: user.id }]);

      const caller = householdsRouter.createCaller({ ...ctx, multiplexer: null } as any);
      const result = await caller.generateInviteToken({ householdId: inviteHousehold.id });

      expect(result).toEqual({ inviteToken: VALID_TOKEN });
      expect(householdDb.generateInviteToken).toHaveBeenCalledWith(inviteHousehold.id, user.id);
    });

    it("throws FORBIDDEN for a non-admin (no token generated)", async () => {
      householdDb.isUserHouseholdAdmin.mockResolvedValue(false);

      const caller = householdsRouter.createCaller({ ...ctx, multiplexer: null } as any);

      await expect(
        caller.generateInviteToken({ householdId: inviteHousehold.id })
      ).rejects.toThrow("Only the household admin can generate an invite link");
      expect(householdDb.generateInviteToken).not.toHaveBeenCalled();
    });
  });

  // The settings DTO must carry the EXISTING invite token for the admin (so the
  // admin sees the already-shared link instead of minting a new one and silently
  // revoking it), and MUST NOT carry it for a non-admin member (leak guard).
  describe("get (settings DTO invite-token visibility)", () => {
    it("includes the existing inviteToken in the ADMIN settings DTO", async () => {
      householdDb.getActiveHouseholdForUser.mockResolvedValue({
        ...inviteHousehold,
        version: 1,
        adminUserId: user.id, // requester IS the admin
        users: [{ id: user.id, name: user.name, version: 1 }],
      });
      householdDb.getInviteToken.mockResolvedValue(VALID_TOKEN);

      const caller = householdsRouter.createCaller({ ...ctx, multiplexer: null } as any);
      const result = await caller.get();

      // Admin-gated fetch ran for the requesting admin's active household...
      expect(householdDb.getInviteToken).toHaveBeenCalledWith(inviteHousehold.id);
      // ...and the current token is on the admin DTO so the UI shows the live link.
      expect(result.household).toHaveProperty("inviteToken", VALID_TOKEN);
    });

    it("does NOT include inviteToken in the MEMBER settings DTO (and never fetches it)", async () => {
      householdDb.getActiveHouseholdForUser.mockResolvedValue({
        ...inviteHousehold,
        version: 1,
        adminUserId: "someone-else", // requester is a plain member
        users: [{ id: user.id, name: user.name, version: 1 }],
      });

      const caller = householdsRouter.createCaller({ ...ctx, multiplexer: null } as any);
      const result = await caller.get();

      // Leak guard: the member-facing DTO must not carry the admin-only token...
      expect(result.household).not.toHaveProperty("inviteToken");
      // ...and the token is never even read for a non-admin (admin-gated).
      expect(householdDb.getInviteToken).not.toHaveBeenCalled();
    });
  });
});
