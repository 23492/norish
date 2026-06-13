"use client";

import { useTranslations } from "next-intl";

import { CreateOrJoinCookbookForms } from "@/components/shared/create-or-join-cookbook-modal";

export default function NoHouseholdView() {
  const t = useTranslations("settings.household");

  return (
    <div className="flex w-full flex-col gap-6">
      <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>

      <CreateOrJoinCookbookForms />
    </div>
  );
}
