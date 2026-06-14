// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { genericOAuth } from "better-auth/plugins";

// WorkOS provider wiring — hermetic. NO real WorkOS network. We mock the provider cache
// (the only input to buildWorkOSProviders) plus auth.ts's heavy module-load dependencies
// (db/redis/queue/repos/logger) so importing the auth barrel is side-effect-free and fast.
// buildWorkOSProviders is exported from auth.ts.
//
// WorkOS AuthKit is wired as a STANDARD OIDC genericOAuth provider via discoveryUrl. The
// previous (broken) config used a custom getToken + authorizationUrl with NO tokenUrl/
// discoveryUrl, which better-auth's /sign-in/oauth2 endpoint rejects with
// INVALID_OAUTH_CONFIGURATION (it requires BOTH an auth URL and a token URL up front,
// before any custom getToken would run). These tests lock in the discovery-based shape
// and assert it satisfies better-auth's sign-in validity predicate.

let workosCacheValue:
  | { clientId?: string; apiKey?: string; authkitDomain?: string; isOverridden?: boolean }
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
vi.mock("@norish/queue/redis/client", () => ({
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
vi.mock("@norish/config/server-config-loader", () => ({ isRegistrationEnabled: vi.fn(async () => true) }));
vi.mock("@norish/shared-server/logger", () => ({
  authLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CLIENT_ID = "client_123";
const API_KEY = "sk_test_abc";
const AUTHKIT_DOMAIN = "manageable-invention-37-staging.authkit.app";
const DISCOVERY_URL = `https://${AUTHKIT_DOMAIN}/.well-known/openid-configuration`;

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

  it("returns no provider when the apiKey is missing", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: undefined, authkitDomain: AUTHKIT_DOMAIN };
    const { buildWorkOSProviders } = await import("@norish/auth");

    expect(buildWorkOSProviders()).toEqual([]);
  });

  it("returns no provider when the authkitDomain is missing", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY, authkitDomain: undefined };
    const { buildWorkOSProviders } = await import("@norish/auth");

    expect(buildWorkOSProviders()).toEqual([]);
  });

  it("builds a standard-OIDC genericOAuth provider from the AuthKit discovery URL", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY, authkitDomain: AUTHKIT_DOMAIN };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const providers = buildWorkOSProviders();

    expect(providers).toHaveLength(1);
    const p = providers[0];

    // Callback stays /api/auth/oauth2/callback/workos (registered in WorkOS) because
    // providerId is unchanged.
    expect(p.providerId).toBe("workos");
    // OIDC discovery supplies authorize/token/userinfo/jwks — fixes INVALID_OAUTH_CONFIGURATION.
    expect(p.discoveryUrl).toBe(DISCOVERY_URL);
    expect(p.clientId).toBe(CLIENT_ID);
    // The WorkOS API Key doubles as the OAuth client_secret (client_secret_post).
    expect(p.clientSecret).toBe(API_KEY);
    expect(p.scopes).toEqual(["openid", "email", "profile"]);
    expect(p.pkce).toBe(true);
    // The non-standard api.workos.com hooks are gone; OIDC handles token + userinfo.
    expect(p.getToken).toBeUndefined();
    expect(p.getUserInfo).toBeUndefined();
    expect(p.authorizationUrl).toBeUndefined();
    expect(p.authorizationUrlParams).toBeUndefined();
  });

  it("derives the discovery URL safely regardless of a stray scheme or trailing slash", async () => {
    // The value is a host, not a URL; the builder tolerates a stray https:// prefix and/or
    // trailing slash so the .well-known path is always exactly right.
    const { buildWorkOSProviders } = await import("@norish/auth");

    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY, authkitDomain: `${AUTHKIT_DOMAIN}/` };
    expect(buildWorkOSProviders()[0].discoveryUrl).toBe(DISCOVERY_URL);

    workosCacheValue = {
      clientId: CLIENT_ID,
      apiKey: API_KEY,
      authkitDomain: `https://${AUTHKIT_DOMAIN}`,
    };
    expect(buildWorkOSProviders()[0].discoveryUrl).toBe(DISCOVERY_URL);
  });

  it("produces a config that better-auth's genericOAuth accepts at /sign-in/oauth2 (no INVALID_OAUTH_CONFIGURATION)", async () => {
    workosCacheValue = { clientId: CLIENT_ID, apiKey: API_KEY, authkitDomain: AUTHKIT_DOMAIN };
    const { buildWorkOSProviders } = await import("@norish/auth");

    const config = buildWorkOSProviders();
    const plugin = genericOAuth({ config });

    // The sign-in endpoint validity check (better-auth 1.6.x): it destructures
    // discoveryUrl/authorizationUrl/tokenUrl from the matched provider config, resolves
    // finalAuthUrl + finalTokenUrl (from discovery when discoveryUrl is set), and throws
    // INVALID_OAUTH_CONFIGURATION when EITHER is missing. We mirror that resolution here
    // against our actual config, with the discovery fetch mocked to the real AuthKit shape.
    const stored = plugin.options.config.find((c: any) => c.providerId === "workos");

    expect(stored).toBeDefined();
    expect(stored!.providerId).toBe("workos");

    const discoveryDoc = {
      authorization_endpoint: `https://${AUTHKIT_DOMAIN}/oauth2/authorize`,
      token_endpoint: `https://${AUTHKIT_DOMAIN}/oauth2/token`,
      userinfo_endpoint: `https://${AUTHKIT_DOMAIN}/oauth2/userinfo`,
      jwks_uri: `https://${AUTHKIT_DOMAIN}/oauth2/jwks`,
    };

    // Replicate better-auth's signInWithOAuth2 finalAuthUrl/finalTokenUrl resolution.
    let finalAuthUrl = stored!.authorizationUrl;
    let finalTokenUrl = (stored as any).tokenUrl;

    if (stored!.discoveryUrl) {
      // (would be fetched from stored.discoveryUrl in production)
      finalAuthUrl = discoveryDoc.authorization_endpoint;
      finalTokenUrl = discoveryDoc.token_endpoint;
    }

    // The exact predicate that throws INVALID_OAUTH_CONFIGURATION at sign-in:
    const wouldThrowInvalidOAuthConfiguration = !finalAuthUrl || !finalTokenUrl;

    expect(wouldThrowInvalidOAuthConfiguration).toBe(false);
    expect(finalAuthUrl).toBe(discoveryDoc.authorization_endpoint);
    expect(finalTokenUrl).toBe(discoveryDoc.token_endpoint);
  });
});
