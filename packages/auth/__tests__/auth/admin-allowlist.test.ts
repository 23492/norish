/**
 * @vitest-environment node
 *
 * Env-driven SERVER-admin allowlist (ADMIN_EMAILS) — R2 / phase 15.
 *
 * SECURITY-SENSITIVE: these tests pin the env-authoritative server-admin contract.
 * The allowlist is mocked via @norish/config/env-config-server (mutable SERVER_CONFIG)
 * and the repo writes via @norish/db/repositories/users, mirroring claim-processor.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mocked env so each test controls ADMIN_EMAILS (already normalized to a
// lowercased/trimmed string[] by the real env transform; tests pass it pre-normalized).
const mockServerConfig: { ADMIN_EMAILS: string[] } = { ADMIN_EMAILS: [] };

vi.mock("@norish/config/env-config-server", () => ({
  get SERVER_CONFIG() {
    return mockServerConfig;
  },
}));

const mockGetUserById = vi.fn();
const mockGetUserServerRole = vi.fn();
const mockSetUserAdminStatus = vi.fn();
const mockSetUserServerRole = vi.fn();

vi.mock("@norish/db/repositories/users", () => ({
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
  getUserServerRole: (...args: unknown[]) => mockGetUserServerRole(...args),
  setUserAdminStatus: (...args: unknown[]) => mockSetUserAdminStatus(...args),
  setUserServerRole: (...args: unknown[]) => mockSetUserServerRole(...args),
}));

vi.mock("@norish/shared-server/logger", () => ({
  authLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  applyServerAdminOnLogin,
  getAdminEmailSet,
  isAdminEmail,
  isAllowlistConfigured,
  resolveServerAdminOnCreate,
} from "@norish/auth/admin-allowlist";

beforeEach(() => {
  mockServerConfig.ADMIN_EMAILS = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("getAdminEmailSet / isAdminEmail (parse + normalize)", () => {
  it("builds a lowercased, trimmed set from SERVER_CONFIG.ADMIN_EMAILS", () => {
    mockServerConfig.ADMIN_EMAILS = ["Admin@Example.com ", "  ops@example.com"];
    const set = getAdminEmailSet();

    expect(set.has("admin@example.com")).toBe(true);
    expect(set.has("ops@example.com")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("drops empty entries and an empty list yields an empty set", () => {
    mockServerConfig.ADMIN_EMAILS = [];
    expect(getAdminEmailSet().size).toBe(0);
    expect(isAllowlistConfigured(getAdminEmailSet())).toBe(false);
  });

  it("membership is case-insensitive and whitespace-trimmed", () => {
    const set = new Set(["admin@example.com"]);

    expect(isAdminEmail("ADMIN@EXAMPLE.COM", set)).toBe(true);
    expect(isAdminEmail("  Admin@Example.com  ", set)).toBe(true);
    expect(isAdminEmail("other@example.com", set)).toBe(false);
    expect(isAdminEmail(null, set)).toBe(false);
    expect(isAdminEmail(undefined, set)).toBe(false);
    expect(isAdminEmail("", set)).toBe(false);
  });
});

describe("resolveServerAdminOnCreate (env-authoritative create decision)", () => {
  it("email IN the list => admin (owner stays false)", () => {
    const adminSet = new Set(["admin@example.com"]);

    expect(
      resolveServerAdminOnCreate({ email: "admin@example.com", isFirstUser: false, adminSet })
    ).toEqual({ isServerOwner: false, isServerAdmin: true });
  });

  it("email NOT in the list => NOT admin", () => {
    const adminSet = new Set(["admin@example.com"]);

    expect(
      resolveServerAdminOnCreate({ email: "intruder@example.com", isFirstUser: false, adminSet })
    ).toEqual({ isServerOwner: false, isServerAdmin: false });
  });

  it("FIRST user NOT in the list => NOT auto-admin (the core SaaS fix)", () => {
    const adminSet = new Set(["admin@example.com"]);

    // Even though this is the first signup, an allowlist is configured and the
    // email is not in it => regular user.
    expect(
      resolveServerAdminOnCreate({ email: "firstrandom@example.com", isFirstUser: true, adminSet })
    ).toEqual({ isServerOwner: false, isServerAdmin: false });
  });

  it("case-insensitive match at create", () => {
    const adminSet = new Set(["admin@example.com"]);

    expect(
      resolveServerAdminOnCreate({ email: "ADMIN@Example.com", isFirstUser: false, adminSet })
    ).toEqual({ isServerOwner: false, isServerAdmin: true });
  });

  it("empty allowlist => fallback to first-user-owner (self-host)", () => {
    const adminSet = new Set<string>();

    // First user becomes owner+admin.
    expect(
      resolveServerAdminOnCreate({ email: "anyone@example.com", isFirstUser: true, adminSet })
    ).toEqual({ isServerOwner: true, isServerAdmin: true });

    // A later user is a regular user.
    expect(
      resolveServerAdminOnCreate({ email: "second@example.com", isFirstUser: false, adminSet })
    ).toEqual({ isServerOwner: false, isServerAdmin: false });
  });
});

describe("applyServerAdminOnLogin (per-login re-evaluation)", () => {
  it("empty allowlist => NO-OP (no repo writes; self-host owners preserved)", async () => {
    mockServerConfig.ADMIN_EMAILS = [];

    await applyServerAdminOnLogin("user-1");

    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(mockSetUserAdminStatus).not.toHaveBeenCalled();
    expect(mockSetUserServerRole).not.toHaveBeenCalled();
  });

  it("email IN list & not yet admin => promote (setUserAdminStatus true)", async () => {
    mockServerConfig.ADMIN_EMAILS = ["admin@example.com"];
    mockGetUserById.mockResolvedValue({ id: "user-1", email: "Admin@Example.com" });
    mockGetUserServerRole.mockResolvedValue({ isOwner: false, isAdmin: false });

    await applyServerAdminOnLogin("user-1");

    expect(mockSetUserAdminStatus).toHaveBeenCalledWith("user-1", true);
    expect(mockSetUserServerRole).not.toHaveBeenCalled();
  });

  it("email IN list & already admin => no write", async () => {
    mockServerConfig.ADMIN_EMAILS = ["admin@example.com"];
    mockGetUserById.mockResolvedValue({ id: "user-1", email: "admin@example.com" });
    mockGetUserServerRole.mockResolvedValue({ isOwner: false, isAdmin: true });

    await applyServerAdminOnLogin("user-1");

    expect(mockSetUserAdminStatus).not.toHaveBeenCalled();
    expect(mockSetUserServerRole).not.toHaveBeenCalled();
  });

  it("email NOT in list & currently admin => DEMOTE (setUserServerRole false,false)", async () => {
    mockServerConfig.ADMIN_EMAILS = ["admin@example.com"];
    mockGetUserById.mockResolvedValue({ id: "user-2", email: "ex-owner@example.com" });
    mockGetUserServerRole.mockResolvedValue({ isOwner: true, isAdmin: true });

    await applyServerAdminOnLogin("user-2");

    expect(mockSetUserServerRole).toHaveBeenCalledWith("user-2", false, false);
    expect(mockSetUserAdminStatus).not.toHaveBeenCalled();
  });

  it("email NOT in list & already regular => no write", async () => {
    mockServerConfig.ADMIN_EMAILS = ["admin@example.com"];
    mockGetUserById.mockResolvedValue({ id: "user-3", email: "regular@example.com" });
    mockGetUserServerRole.mockResolvedValue({ isOwner: false, isAdmin: false });

    await applyServerAdminOnLogin("user-3");

    expect(mockSetUserAdminStatus).not.toHaveBeenCalled();
    expect(mockSetUserServerRole).not.toHaveBeenCalled();
  });

  it("never throws on a repo failure (login must not hard-fail)", async () => {
    mockServerConfig.ADMIN_EMAILS = ["admin@example.com"];
    mockGetUserById.mockRejectedValue(new Error("db down"));

    await expect(applyServerAdminOnLogin("user-4")).resolves.toBeUndefined();
  });
});
