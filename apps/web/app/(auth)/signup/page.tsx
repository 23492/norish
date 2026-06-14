import { redirect } from "next/navigation";
import { isPasswordAuthEnabled } from "@norish/auth/providers";
import { isRegistrationEnabled } from "@norish/config/server-config-loader";

import { SignupClient } from "./components/signup-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SignupPageProps {
  searchParams: Promise<{ callbackUrl?: string; sso?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const [passwordEnabled, registrationEnabled] = await Promise.all([
    isPasswordAuthEnabled(),
    isRegistrationEnabled(),
  ]);

  const { callbackUrl = "/", sso } = await searchParams;

  // Redirect to login if password auth or registration is disabled. When
  // password auth is off there is no norish-only sign-up; the login page is the
  // single entry point and will auto-redirect to SSO when it is the sole
  // provider. Forward `?sso=0` so the recovery hatch survives the redirect.
  if (!passwordEnabled || !registrationEnabled) {
    redirect(sso === "0" ? "/login?sso=0" : "/login");
  }

  return <SignupClient callbackUrl={callbackUrl} />;
}
