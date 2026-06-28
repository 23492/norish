// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { genericOAuth } from "better-auth/plugins";

// WorkOS provider wiring — hermetic. NO real WorkOS network. We mock the provider cache
// (the only input to buildWorkOSProviders) plus auth.ts's heavy module-load dependencies
// (db/redis/queue/repos/logger) so importing the auth barrel is side-effect-free and fast.
// buildWorkOSProviders is exported from auth.ts.
//
// WorkOS AuthKit is wired as a FIRST-PARTY genericOAuth provider against api.workos.com
// (authorizationUrl /user_management/authorize?provider=authkit + a custom getToken doing
// POST /user_management/authenticate, which returns the user directly). A `tokenUrl` is set
// PURELY to satisfy better-auth's /sign-in/oauth2 config validation (it requires both an
// auth URL and a token URL up front) — it is never fetched because the custom getToken takes
// precedence in the callback. These tests lock in that shape and assert the config passes the
// sign-in validity predicate AND that the authorize URL is api.workos.com (NOT *.authkit.app,
// the WRONG Connect surface that produced "application not found").

let workosCacheValue:
  | { clientId?: string; apiKey?: string; isOverridden?: boolean }
  | null = null;

vi.mock("@norish/auth/provider-cache", () => ({
  getCachedGitHubProvider: () => null,
  getCachedGoogleProvider: () => null,
  getCachedOIDCProvider: () => null,
  getCachedWorkOSProvider: () => workosCacheValue,
  getCachedOIDCClaimConfig: () => null,
  getCachedPasswordAuthEnabled: () => false,
  setAuthProviderCache: vi.fn(),
}));

// Heavy auth.ts deps — stub so importing the module does not touch a DB/redis.
vi.mock("@norish/db/drizzle", () => ({ db: {} }));
vi.mock("@norish/shared-server/redis/client", () => ({
  getPublisherClient: vi.fn(async () => ({
    get: vi.fn(),
    set: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  })),
}));
vi.mock("@norish/db/repositories/api-keys", () => ({ setApiKeyAuthService: vi.fn() }));
vi.mock("@norish/db/repositories/server-config", () => ({ setConfig: vi.fn() }));
vi.mock("@norish/db/repositories/households", () => ({
  addUserToHousehold: vi.fn(),
  createHousehold: vi.fn(),
  getHouseholdsForUser: vi.fn(async () => []),
  setActiveHousehold: vi.fn(),
}));
vi.mock("@norish/db/repositories/users", () => ({ countUsers: vi.fn(async () => 0) }));
vi.mock("@norish/shared-server/config/server-config-loader", () => ({
  isRegistrationEnabled: vi.fn(async () => true),
}));
vi.mock("@norish/shared-server/logger", () => ({
  authLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const CLIENT_ID = "client_123";
const API_KEY = "sk_test_abc";
const AUTHORIZE_URL = "https://api.workos.com/user_management/authorize";
const AUTHENTICATE_URL = "https://api.workos.com/user_management/authenticate";

describe("buildWorkOSProviders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workosCacheValue = null;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns no provider when WorkOS is not configured", async () => {
    workosCacheValue = null;
    const { buildWorkOSProviders } = await import("@norish/auth");

    expect(buildWorkOSProviders()).toEqual([]);
  });

  it("returns no provider when only the clientId is set (no apiKey)", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: undefined };
    const { buildWorkOSProviders } = await import("@norish/auth");

    expect(buildWorkOSProviders()).toEqual([]);
  });

  it("builds a first-party AuthKit genericOAuth provider (api.workos.com authorize + tokenUrl placeholder)", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const providers = buildWorkOSProviders();

    expect(providers).toHaveLength(1);
    const p = providers[0];

    // Callback stays /api/auth/oauth2/callback/workos (registered in WorkOS) because
    // providerId is unchanged.
    expect(p.providerId).toBe("workos");
    expect(p.clientId).toBe(CLIENT_ID);
    // The WorkOS API Key doubles as the OAuth client_secret for the authenticate call.
    expect(p.clientSecret).toBe(API_KEY);
    // First-party AuthKit, NOT the *.authkit.app Connect surface.
    expect(p.authorizationUrl).toBe(AUTHORIZE_URL);
    expect(p.authorizationUrlParams).toEqual({ provider: "authkit" });
    // tokenUrl present ONLY to satisfy better-auth's sign-in config validation; the custom
    // getToken takes precedence at the callback so it is never actually fetched.
    expect(p.tokenUrl).toBe(AUTHENTICATE_URL);
    expect(p.responseType).toBe("code");
    expect(p.pkce).toBe(false);
    expect(p.scopes).toEqual([]);
    // The non-standard exchange is done in getToken; the profile is mapped in getUserInfo.
    expect(typeof p.getToken).toBe("function");
    expect(typeof p.getUserInfo).toBe("function");
    // It must NOT be the (wrong) OIDC-discovery shape from phase 11.
    expect(p.discoveryUrl).toBeUndefined();
  });

  it("getToken exchanges the code at the WorkOS authenticate endpoint and preserves the raw response", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const workosResponse = {
      access_token: "at_xyz",
      refresh_token: "rt_xyz",
      user: { id: "user_01", email: "jane@example.com", email_verified: true },
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => workosResponse,
    }));

    vi.stubGlobal("fetch", fetchMock);

    const tokens = await buildWorkOSProviders()[0].getToken({
      code: "auth_code_123",
      redirectURI: "https://norish.example.com/api/auth/oauth2/callback/workos",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(AUTHENTICATE_URL);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);

    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.client_secret).toBe(API_KEY);
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("auth_code_123");

    expect(tokens.accessToken).toBe("at_xyz");
    expect(tokens.refreshToken).toBe("rt_xyz");
    // The full WorkOS response (incl. the user) is preserved for getUserInfo.
    expect(tokens.raw).toEqual(workosResponse);

    vi.unstubAllGlobals();
  });

  it("getToken throws when the WorkOS authenticate call fails", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      buildWorkOSProviders()[0].getToken({
        code: "bad",
        redirectURI: "https://norish.example.com/api/auth/oauth2/callback/workos",
      })
    ).rejects.toThrow(/WorkOS token exchange failed: 401/);

    vi.unstubAllGlobals();
  });

  it("getUserInfo maps the WorkOS user profile to norish user fields", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const user = await buildWorkOSProviders()[0].getUserInfo({
      raw: {
        user: {
          id: "user_01",
          email: "jane@example.com",
          email_verified: true,
          first_name: "Jane",
          last_name: "Doe",
          profile_picture_url: "https://img.example.com/jane.png",
        },
      },
    });

    expect(user).toEqual({
      id: "user_01",
      email: "jane@example.com",
      emailVerified: true,
      name: "Jane Doe",
      image: "https://img.example.com/jane.png",
    });
  });

  it("getUserInfo falls back to the email for the name and returns null when no user is present", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const provider = buildWorkOSProviders()[0];

    // No names -> name falls back to email; unverified email -> emailVerified false; no picture -> undefined image.
    const user = await provider.getUserInfo({
      raw: { user: { id: "user_02", email: "no-name@example.com" } },
    });

    expect(user).toEqual({
      id: "user_02",
      email: "no-name@example.com",
      emailVerified: false,
      name: "no-name@example.com",
      image: undefined,
    });

    // No user object at all -> null (better-auth then redirects user_info_is_missing).
    expect(await provider.getUserInfo({ raw: {} })).toBeNull();
  });

  it("produces a config better-auth accepts at /sign-in/oauth2 with an api.workos.com authorize URL (no INVALID_OAUTH_CONFIGURATION, not the Connect surface)", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const config = buildWorkOSProviders();
    const plugin = genericOAuth({ config });
    const stored = plugin.options.config.find((c: any) => c.providerId === "workos");

    expect(stored).toBeDefined();

    // Replicate better-auth's signInWithOAuth2 finalAuthUrl/finalTokenUrl resolution
    // (node_modules/better-auth/dist/plugins/generic-oauth/routes.mjs):
    //   let finalAuthUrl = authorizationUrl; let finalTokenUrl = tokenUrl;
    //   if (discoveryUrl) { /* fetch overrides both */ }
    //   if (!finalAuthUrl || !finalTokenUrl) throw INVALID_OAUTH_CONFIGURATION;
    // No discoveryUrl here, so the explicit authorizationUrl + tokenUrl must both be set.
    const finalAuthUrl = (stored as any).discoveryUrl
      ? "<from-discovery>"
      : stored!.authorizationUrl;
    const finalTokenUrl = (stored as any).discoveryUrl
      ? "<from-discovery>"
      : (stored as any).tokenUrl;

    const wouldThrowInvalidOAuthConfiguration = !finalAuthUrl || !finalTokenUrl;

    expect(wouldThrowInvalidOAuthConfiguration).toBe(false);
    // The authorize URL must be first-party AuthKit (api.workos.com), NOT *.authkit.app
    // (the Connect/OAuth-Applications surface that needs a separate client_id and caused
    // "The application you are trying to authorize was not found").
    expect(finalAuthUrl).toBe(AUTHORIZE_URL);
    expect(new URL(finalAuthUrl as string).host).toBe("api.workos.com");
    expect(finalAuthUrl).not.toContain("authkit.app");
  });
});
