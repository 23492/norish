// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServerConfigKeys } from "@norish/config/zod/server-config";

const mockGetConfig = vi.fn();
const mockSetConfig = vi.fn();
const mockDeleteConfig = vi.fn();
const mockConfigExists = vi.fn();
const mockNormalizeAndBackfillConfig = vi.fn();
let mockServerConfig: Record<string, unknown> = {};

vi.mock("@norish/db/repositories/server-config", () => ({
  getConfig: mockGetConfig,
  setConfig: mockSetConfig,
  deleteConfig: mockDeleteConfig,
  configExists: mockConfigExists,
  normalizeAndBackfillConfig: mockNormalizeAndBackfillConfig,
}));

vi.mock("@norish/auth/provider-cache", () => ({
  setAuthProviderCache: vi.fn(),
}));

vi.mock("@norish/shared-server/logger", () => ({
  serverLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@norish/config/env-config-server", () => ({
  get SERVER_CONFIG() {
    return mockServerConfig;
  },
}));

vi.mock("@norish/config/units.default.json", () => ({ default: {} }));
vi.mock("@norish/config/content-indicators.default.json", () => ({
  default: { schemaIndicators: [], contentIndicators: [] },
}));
vi.mock("@norish/config/recurrence-config.default.json", () => ({
  default: { locales: {} },
}));
vi.mock("@norish/shared-server/ai/prompts/loader", () => ({
  loadDefaultPrompts: vi.fn().mockReturnValue({
    recipeExtraction: "mock recipe extraction prompt",
    unitConversion: "mock unit conversion prompt",
  }),
}));

/**
 * Auth toggles (registration_enabled / password_auth_enabled) are seeded/UPDATEd from env
 * on EVERY boot via syncAuthTogglesFromEnv (R4), mirroring syncAIConfigFromEnv. The env vars
 * are parsed to booleans by the zod schema BEFORE SERVER_CONFIG is read here, so these tests
 * drive the parsed boolean (true / false / undefined) directly on the SERVER_CONFIG mock —
 * `undefined` is the "env unset" signal that must be a no-op.
 */
describe("Auth Toggles Env Sync (registration_enabled + password_auth_enabled)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockServerConfig = {};
    mockDeleteConfig.mockResolvedValue(undefined);
    mockNormalizeAndBackfillConfig.mockResolvedValue(false);
    // Default: every config key already exists (REQUIRED_CONFIGS seeded), so
    // seedMissingConfigs() does nothing and we isolate the env-sync behavior.
    mockConfigExists.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.resetModules();
  });

  const regCall = () =>
    mockSetConfig.mock.calls.find((call) => call[0] === ServerConfigKeys.REGISTRATION_ENABLED);
  const pwCall = () =>
    mockSetConfig.mock.calls.find((call) => call[0] === ServerConfigKeys.PASSWORD_AUTH_ENABLED);

  it("commercial preset: REGISTRATION_ENABLED=true + PASSWORD_AUTH_ENABLED=false overrides a stale DB on boot", async () => {
    // Arrange — the exact WorkOS-only-launch drift: DB has registration OFF (auto-disabled after
    // first user) and password ON, but env says registration OPEN + password OFF. Env must win.
    mockServerConfig = { REGISTRATION_ENABLED: true, PASSWORD_AUTH_ENABLED: false };
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.REGISTRATION_ENABLED) return Promise.resolve(false);
      if (key === ServerConfigKeys.PASSWORD_AUTH_ENABLED) return Promise.resolve(true);

      return Promise.resolve(null);
    });
    const { seedServerConfig } = await import("@norish/api/startup/seed-config");

    // Act
    await seedServerConfig();

    // Assert — env wins for both; written non-sensitive (plain bool).
    expect(regCall()).toBeDefined();
    expect(regCall()![1]).toBe(true);
    expect(regCall()![3]).toBe(false);
    expect(pwCall()).toBeDefined();
    expect(pwCall()![1]).toBe(false);
    expect(pwCall()![3]).toBe(false);
  });

  it("overrides the post-first-user auto-disable: env REGISTRATION_ENABLED=true beats DB false", async () => {
    // Arrange — auth.ts sets registration_enabled=false after the first signup; on the next boot
    // env re-opens it (commercial SaaS keeps signup open). This is the key R4 behaviour.
    mockServerConfig = { REGISTRATION_ENABLED: true };
    mockGetConfig.mockImplementation((key: string) =>
      Promise.resolve(key === ServerConfigKeys.REGISTRATION_ENABLED ? false : null)
    );
    const { seedServerConfig } = await import("@norish/api/startup/seed-config");

    // Act
    await seedServerConfig();

    // Assert
    expect(regCall()).toBeDefined();
    expect(regCall()![1]).toBe(true);
    // password toggle untouched (env unset)
    expect(pwCall()).toBeUndefined();
  });

  it("is a NO-OP for each toggle when its env var is UNSET (DB/admin value preserved)", async () => {
    // Arrange — neither env var set; DB has arbitrary values that must NOT be rewritten.
    mockServerConfig = {};
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.REGISTRATION_ENABLED) return Promise.resolve(false);
      if (key === ServerConfigKeys.PASSWORD_AUTH_ENABLED) return Promise.resolve(true);

      return Promise.resolve(null);
    });
    const { seedServerConfig } = await import("@norish/api/startup/seed-config");

    // Act
    await seedServerConfig();

    // Assert — no writes to either toggle.
    expect(regCall()).toBeUndefined();
    expect(pwCall()).toBeUndefined();
  });

  it("does NOT rewrite a toggle when env already equals the DB value (no needless version bump)", async () => {
    // Arrange — env matches DB for both.
    mockServerConfig = { REGISTRATION_ENABLED: true, PASSWORD_AUTH_ENABLED: false };
    mockGetConfig.mockImplementation((key: string) => {
      if (key === ServerConfigKeys.REGISTRATION_ENABLED) return Promise.resolve(true);
      if (key === ServerConfigKeys.PASSWORD_AUTH_ENABLED) return Promise.resolve(false);

      return Promise.resolve(null);
    });
    const { seedServerConfig } = await import("@norish/api/startup/seed-config");

    // Act
    await seedServerConfig();

    // Assert — no writes.
    expect(regCall()).toBeUndefined();
    expect(pwCall()).toBeUndefined();
  });

  it("parses env false (0/false) as an explicit value: env false overrides a DB true", async () => {
    // Arrange — the parsed env boolean is false (operator wrote PASSWORD_AUTH_ENABLED=false),
    // which is DISTINCT from undefined: it must overwrite a DB true, not be treated as unset.
    mockServerConfig = { REGISTRATION_ENABLED: false, PASSWORD_AUTH_ENABLED: false };
    mockGetConfig.mockImplementation((key: string) =>
      // Both DB rows are true; env false must flip them.
      Promise.resolve(
        key === ServerConfigKeys.REGISTRATION_ENABLED ||
          key === ServerConfigKeys.PASSWORD_AUTH_ENABLED
          ? true
          : null
      )
    );
    const { seedServerConfig } = await import("@norish/api/startup/seed-config");

    // Act
    await seedServerConfig();

    // Assert — env false written for both.
    expect(regCall()).toBeDefined();
    expect(regCall()![1]).toBe(false);
    expect(pwCall()).toBeDefined();
    expect(pwCall()![1]).toBe(false);
  });

  it("seeds the toggle when no DB row exists yet (getConfig null) and env is set", async () => {
    // Arrange — clean DB edge: getConfig returns null (no row); env set => write.
    mockServerConfig = { PASSWORD_AUTH_ENABLED: false };
    mockGetConfig.mockResolvedValue(null);
    const { seedServerConfig } = await import("@norish/api/startup/seed-config");

    // Act
    await seedServerConfig();

    // Assert — null !== false, so it writes the env value.
    expect(pwCall()).toBeDefined();
    expect(pwCall()![1]).toBe(false);
    expect(regCall()).toBeUndefined();
  });

  it("re-seeds idempotently across two boots (env stays authoritative)", async () => {
    // Boot 1 — DB registration false (auto-disabled), env opens it.
    mockServerConfig = { REGISTRATION_ENABLED: true };
    mockGetConfig.mockImplementation((key: string) =>
      Promise.resolve(key === ServerConfigKeys.REGISTRATION_ENABLED ? false : null)
    );
    let { seedServerConfig } = await import("@norish/api/startup/seed-config");
    await seedServerConfig();
    expect(regCall()![1]).toBe(true);

    // Boot 2 — DB now equals env (true); no rewrite.
    vi.resetModules();
    mockSetConfig.mockClear();
    mockServerConfig = { REGISTRATION_ENABLED: true };
    mockGetConfig.mockImplementation((key: string) =>
      Promise.resolve(key === ServerConfigKeys.REGISTRATION_ENABLED ? true : null)
    );
    ({ seedServerConfig } = await import("@norish/api/startup/seed-config"));
    await seedServerConfig();
    expect(regCall()).toBeUndefined();
  });
});
