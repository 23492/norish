"use client";

import type { HouseholdAdminSettingsDto } from "@norish/shared/contracts/dto/household";

import { useEffect, useState } from "react";
import {
  ArrowPathIcon,
  ClipboardDocumentIcon as ClipboardDocumentIconSolid,
} from "@heroicons/react/16/solid";
import {
  ClipboardDocumentIcon as ClipboardDocumentIconOutline,
  LinkIcon,
} from "@heroicons/react/24/outline";
import { addToast, Button, Card, CardBody, CardHeader, Divider, Input } from "@heroui/react";
import { useTranslations } from "next-intl";


import { useHouseholdSettingsContext } from "../context";

import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";

export default function JoinCodeCard() {
  const t = useTranslations("settings.household.joinCode");
  const tInvite = useTranslations("settings.household.invite");
  const tErrors = useTranslations("common.errors");
  const { household, currentUserId, regenerateJoinCode, generateInviteToken } =
    useHouseholdSettingsContext();
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  // Calculate time remaining for join code
  useEffect(() => {
    if (
      !household ||
      !("joinCode" in household) ||
      !household.joinCode ||
      !household.joinCodeExpiresAt
    ) {
      setTimeRemaining("");

      return;
    }

    const calculateTime = () => {
      // Type guard again inside the function
      if (!household || !("joinCodeExpiresAt" in household) || !household.joinCodeExpiresAt) return;

      const now = new Date();
      const expires = new Date(household.joinCodeExpiresAt);
      const diff = expires.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeRemaining("Expired");

        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);

      setTimeRemaining(`${minutes}m ${seconds}s`);
    };

    calculateTime();
    const interval = setInterval(calculateTime, 1000);

    return () => clearInterval(interval);
  }, [household]);

  if (!household) return null;

  // Check if current user is admin and if household has admin fields
  const currentUserData = currentUserId
    ? household.users.find((u) => u.id === currentUserId)
    : null;
  const isAdmin = currentUserData?.isAdmin === true;

  // Type guard: only admins get joinCode fields
  const hasJoinCode = "joinCode" in household;

  if (!isAdmin || !hasJoinCode) return null;

  // Now TypeScript knows household has joinCode fields
  const adminHousehold = household as HouseholdAdminSettingsDto;
  const joinCodeExpired = adminHousehold.joinCodeExpiresAt
    ? new Date(adminHousehold.joinCodeExpiresAt) < new Date()
    : true;

  const handleCopyJoinCode = async () => {
    // Type guard ensures household has joinCode
    if ("joinCode" in household && household.joinCode) {
      try {
        await navigator.clipboard.writeText(household.joinCode);
        addToast({
          title: t("copySuccess"),
          color: "success",
          shouldShowTimeoutProgress: true,
          radius: "full",
        });
      } catch (error) {
        showSafeErrorToast({
          title: t("copyFailed"),
          description: tErrors("technicalDetails"),
          color: "danger",
          error,
          context: "household-join-code:copy",
        });
      }
    }
  };

  const handleRegenerateCode = async () => {
    await regenerateJoinCode(household.id);
  };

  const inviteToken = "inviteToken" in adminHousehold ? adminHousehold.inviteToken : null;
  const inviteUrl =
    inviteToken && typeof window !== "undefined"
      ? `${window.location.origin}/join/${inviteToken}`
      : "";

  const handleGenerateInviteLink = async () => {
    setIsGeneratingLink(true);
    try {
      await generateInviteToken(household.id);
    } catch (error) {
      showSafeErrorToast({
        title: tInvite("failed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error,
        context: "household-invite-link:generate",
      });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      addToast({
        title: tInvite("copied"),
        color: "success",
        shouldShowTimeoutProgress: true,
        radius: "full",
      });
    } catch (error) {
      showSafeErrorToast({
        title: tInvite("copyFailed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error,
        context: "household-invite-link:copy",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ClipboardDocumentIconOutline className="h-5 w-5" />
          {t("title")}
        </h2>
      </CardHeader>
      <CardBody className="gap-4">
        {adminHousehold.joinCode && !joinCodeExpired ? (
          <>
            <p className="text-default-600 text-base">{t("shareDescription")}</p>
            <div className="flex gap-2">
              <Input
                isReadOnly
                classNames={{ input: "font-mono text-lg tracking-wider" }}
                value={adminHousehold.joinCode || ""}
              />
              <Button isIconOnly onPress={handleCopyJoinCode}>
                <ClipboardDocumentIconSolid className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-default-600 text-base">
                {t("expiresIn")} <span className="text-warning font-medium">{timeRemaining}</span>
              </span>
              <Button
                color="primary"
                size="sm"
                startContent={<ArrowPathIcon className="h-4 w-4" />}
                variant="flat"
                onPress={handleRegenerateCode}
              >
                {t("regenerateButton")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-default-600 text-base">{t("noCodeDescription")}</p>
            <div className="flex justify-end">
              <Button
                color="primary"
                startContent={<ArrowPathIcon className="h-4 w-4" />}
                onPress={handleRegenerateCode}
              >
                {t("generateButton")}
              </Button>
            </div>
          </>
        )}

        <Divider />

        {/* Shareable invite link (long-lived, regenerable). */}
        <div className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <LinkIcon className="h-4 w-4" />
            {tInvite("title")}
          </h3>
          <p className="text-default-600 text-base">{tInvite("description")}</p>
          {inviteToken ? (
            <>
              <div className="flex gap-2">
                <Input
                  isReadOnly
                  classNames={{ input: "font-mono text-sm" }}
                  value={inviteUrl}
                />
                <Button isIconOnly aria-label={tInvite("copy")} onPress={handleCopyInviteLink}>
                  <ClipboardDocumentIconSolid className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex justify-end">
                <Button
                  color="primary"
                  isLoading={isGeneratingLink}
                  size="sm"
                  startContent={<ArrowPathIcon className="h-4 w-4" />}
                  variant="flat"
                  onPress={handleGenerateInviteLink}
                >
                  {tInvite("regenerate")}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <Button
                color="primary"
                isLoading={isGeneratingLink}
                startContent={<LinkIcon className="h-4 w-4" />}
                onPress={handleGenerateInviteLink}
              >
                {tInvite("generate")}
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
