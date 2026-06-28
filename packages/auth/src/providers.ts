import type {
  AuthProviderGitHub,
  AuthProviderGoogle,
  AuthProviderOIDC,
  AuthProviderWorkOS,
} from "@norish/config/zod/server-config";
import type { ProviderInfo } from "@norish/shared/contracts";
import { ServerConfigKeys } from "@norish/config/zod/server-config";
import { getConfig } from "@norish/db/repositories/server-config";

export async function getAvailableProviders(): Promise<ProviderInfo[]> {
  const providers: ProviderInfo[] = [];

  // Check password auth
  const passwordEnabled = await getConfig<boolean>(ServerConfigKeys.PASSWORD_AUTH_ENABLED);

  if (passwordEnabled) {
    providers.push({
      id: "credential",
      name: "Email",
      icon: "mdi:email-outline",
      type: "credential",
    });
  }

  // Check GitHub provider
  const github = await getConfig<AuthProviderGitHub>(ServerConfigKeys.AUTH_PROVIDER_GITHUB, true);

  if (github?.clientId) {
    providers.push({
      id: "github",
      name: "GitHub",
      icon: "mdi:github",
      type: "oauth",
    });
  }

  // Check Google provider
  const google = await getConfig<AuthProviderGoogle>(ServerConfigKeys.AUTH_PROVIDER_GOOGLE, true);

  if (google?.clientId) {
    providers.push({
      id: "google",
      name: "Google",
      icon: "flat-color-icons:google",
      type: "oauth",
    });
  }

  // Check OIDC provider
  const oidc = await getConfig<AuthProviderOIDC>(ServerConfigKeys.AUTH_PROVIDER_OIDC, true);

  if (oidc?.clientId && oidc?.issuer) {
    providers.push({
      id: "oidc",
      name: oidc.name || "SSO",
      icon: "mdi:shield-account-outline",
      type: "oauth",
    });
  }

  // Check WorkOS provider
  const workos = await getConfig<AuthProviderWorkOS>(
    ServerConfigKeys.AUTH_PROVIDER_WORKOS,
    true
  );

  if (workos?.clientId) {
    providers.push({
      id: "workos",
      name: "WorkOS",
      icon: "logos:workos-icon",
      type: "oauth",
    });
  }

  return providers;
}

/**
 * Decide whether the login (or signup) entry point should immediately redirect
 * the unauthenticated visitor straight to the hosted OAuth/SSO flow, bypassing
 * the norish login UI.
 *
 * This is intentionally CONSERVATIVE and SELF-RECOVERING: it only fires when a
 * SINGLE OAuth provider is configured AND no credential (email/password)
 * provider is enabled. If password auth is re-enabled, or a second provider is
 * added, or every provider is removed, this returns false and the normal login
 * page renders again — so a config change can always restore manual access
 * without a code deploy.
 *
 * `escapeRequested` is the user-facing recovery hatch (e.g. `?sso=0` in the URL
 * or a just-completed logout): when true we never auto-redirect, guaranteeing a
 * way to reach the real login page even while SSO-only is active.
 */
export function shouldAutoRedirectToSso(
  providers: ProviderInfo[],
  escapeRequested = false,
): boolean {
  if (escapeRequested) {
    return false;
  }

  const oauthProviders = providers.filter((p) => p.type === "oauth");
  const hasCredential = providers.some((p) => p.type === "credential");

  return oauthProviders.length === 1 && !hasCredential;
}

export async function isPasswordAuthEnabled(): Promise<boolean> {
  const passwordEnabled = await getConfig<boolean>(ServerConfigKeys.PASSWORD_AUTH_ENABLED);

  return passwordEnabled ?? false;
}

export async function getConfiguredProviders(): Promise<Record<string, boolean>> {
  const [github, google, oidc, workos, passwordEnabled] = await Promise.all([
    getConfig<AuthProviderGitHub>(ServerConfigKeys.AUTH_PROVIDER_GITHUB, true),
    getConfig<AuthProviderGoogle>(ServerConfigKeys.AUTH_PROVIDER_GOOGLE, true),
    getConfig<AuthProviderOIDC>(ServerConfigKeys.AUTH_PROVIDER_OIDC, true),
    getConfig<AuthProviderWorkOS>(ServerConfigKeys.AUTH_PROVIDER_WORKOS, true),
    getConfig<boolean>(ServerConfigKeys.PASSWORD_AUTH_ENABLED),
  ]);

  return {
    github: !!github?.clientId,
    google: !!google?.clientId,
    oidc: !!(oidc?.clientId && oidc?.issuer),
    workos: !!workos?.clientId,
    password: !!passwordEnabled,
  };
}
