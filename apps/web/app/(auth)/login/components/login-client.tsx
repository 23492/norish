"use client";

import type { ProviderInfo } from "@norish/shared/contracts";

import { Divider } from "@heroui/react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { AuthCard } from "../../components/auth-card";

import { AutoSignIn } from "./auto-sign-in";
import { EmailPasswordForm } from "./email-password-form";
import { ProviderButton } from "./provider-button";

interface LoginClientProps {
  providers: ProviderInfo[];
  callbackUrl?: string;
  autoRedirect?: boolean;
  registrationEnabled?: boolean;
}

export function LoginClient({
  providers,
  callbackUrl = "/",
  autoRedirect = false,
  registrationEnabled = false,
}: LoginClientProps) {
  const t = useTranslations("auth.login");
  // Separate credential and OAuth providers
  const credentialProvider = providers.find((p) => p.type === "credential");
  const oauthProviders = providers.filter((p) => p.type !== "credential");
  const singleOauthProvider = oauthProviders[0];

  // Auto-redirect for single OAuth provider setups (only if no credential provider)
  if (autoRedirect && oauthProviders.length === 1 && !credentialProvider && singleOauthProvider) {
    return <AutoSignIn callbackUrl={callbackUrl} provider={singleOauthProvider} />;
  }

  const hasCredential = !!credentialProvider;
  const hasOAuth = oauthProviders.length > 0;
  // Render social providers as a compact icon row (AuthKit-widget style) once
  // there are several; a lone provider stays a full labeled button for clarity.
  const useIconRow = oauthProviders.length >= 2;

  return (
    <AuthCard
      footer={
        <div className="mt-6 flex flex-col items-center gap-2">
          {hasOAuth && !hasCredential && (
            <p className="text-small text-default-500 text-center">{t("redirectMessage")}</p>
          )}
          {registrationEnabled && (
            <p className="text-small text-default-500 text-center">
              {t("noAccount")}{" "}
              <Link className="text-primary font-medium hover:underline" href="/signup">
                {t("signUp")}
              </Link>
            </p>
          )}
        </div>
      }
      subtitle={t("subtitle")}
      title={t("title")}
    >
      {/* Email/Password form */}
      {hasCredential && (
        <EmailPasswordForm callbackUrl={callbackUrl} registrationEnabled={registrationEnabled} />
      )}

      {/* Divider between form and OAuth */}
      {hasCredential && hasOAuth && (
        <div className="flex items-center gap-4">
          <Divider className="flex-1" />
          <span className="text-small text-default-400">{t("divider")}</span>
          <Divider className="flex-1" />
        </div>
      )}

      {/* OAuth provider buttons */}
      {hasOAuth && (
        <div
          className={
            useIconRow ? "grid grid-cols-2 gap-3 sm:grid-cols-4" : "flex flex-col gap-3"
          }
        >
          {oauthProviders.map((provider) => (
            <ProviderButton
              key={provider.id}
              callbackUrl={callbackUrl}
              icon={provider.icon}
              iconOnly={useIconRow}
              providerId={provider.id}
              providerName={provider.name}
            />
          ))}
        </div>
      )}

      {/* No providers message */}
      {!hasCredential && !hasOAuth && (
        <div className="py-4 text-center">
          <p className="text-small text-danger">{t("noProviders.title")}</p>
          <p className="text-tiny text-default-500 mt-2">{t("noProviders.contactAdmin")}</p>
        </div>
      )}
    </AuthCard>
  );
}
