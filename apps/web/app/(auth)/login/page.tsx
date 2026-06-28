import { getAvailableProviders, shouldAutoRedirectToSso } from "@norish/auth/providers";
import { isRegistrationEnabled } from "@norish/shared-server/config/server-config-loader";

import { LoginClient } from "./components/login-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string; logout?: string; sso?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [providers, registrationEnabled] = await Promise.all([
    getAvailableProviders(),
    isRegistrationEnabled(),
  ]);

  const { callbackUrl = "/", logout, sso } = await searchParams;
  // Recovery hatch: `?sso=0` (or a just-completed logout) forces the normal
  // login page even when SSO-only auto-redirect is active, so users are never
  // locked into a redirect they can't escape.
  const escapeAutoRedirect = sso === "0" || logout === "true";

  // Only auto-redirect when WorkOS (or any single OAuth provider) is the sole
  // sign-in path: exactly one OAuth provider, no email/password. Falls back to
  // the normal login UI otherwise.
  const shouldAutoRedirect = shouldAutoRedirectToSso(providers, escapeAutoRedirect);

  return (
    <LoginClient
      autoRedirect={shouldAutoRedirect}
      callbackUrl={callbackUrl}
      providers={providers}
      registrationEnabled={registrationEnabled}
    />
  );
}
