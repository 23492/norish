"use client";

import { useRouter } from "next/navigation";
import { BookOpenIcon, CheckIcon, UserGroupIcon } from "@heroicons/react/16/solid";
import { Button, Card, Label } from "@heroui/react";
import { useTranslations } from "next-intl";

import { useHouseholdContext } from "@/context/household-context";

/**
 * Cookbooks browser (CKBK-MOVE-01, scope item 3 / UAT B3). Lists the viewer's
 * cookbooks — Personal + each household they belong to — and lets them switch
 * the active cookbook and browse its recipes. Mirrors the Phase-2 switcher in
 * navbar-user-menu (same households list + switchActive + Personal option).
 */
export default function CookbooksPage() {
  const t = useTranslations("navbar.cookbook");
  const router = useRouter();
  const { households, activeHouseholdId, switchActive } = useHouseholdContext();

  const openCookbook = (householdId: string | null) => {
    switchActive(householdId);
    router.push("/");
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-24 md:pb-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted text-base">{t("subtitle")}</p>
      </div>

      <div className="flex flex-col gap-3">
        {/* Personal cookbook */}
        <Card className="rounded-2xl">
          <Card.Content className="flex items-center gap-4 p-4">
            <span className="text-muted bg-surface-secondary flex size-11 shrink-0 items-center justify-center rounded-full">
              <BookOpenIcon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <Label className="text-base font-semibold">{t("personal")}</Label>
                {activeHouseholdId === null && (
                  <span className="text-accent flex items-center gap-1 text-xs font-medium">
                    <CheckIcon className="size-4" />
                    {t("active")}
                  </span>
                )}
              </div>
              <span className="text-muted truncate text-sm">{t("personalDescription")}</span>
            </div>
            <Button size="sm" variant="tertiary" onPress={() => openCookbook(null)}>
              {t("open")}
            </Button>
          </Card.Content>
        </Card>

        {/* Household cookbooks */}
        {households.map((cookbook) => (
          <Card key={cookbook.id} className="rounded-2xl">
            <Card.Content className="flex items-center gap-4 p-4">
              <span className="text-muted bg-surface-secondary flex size-11 shrink-0 items-center justify-center rounded-full">
                <UserGroupIcon className="size-5" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <Label className="truncate text-base font-semibold">{cookbook.name}</Label>
                  {cookbook.id === activeHouseholdId && (
                    <span className="text-accent flex items-center gap-1 text-xs font-medium">
                      <CheckIcon className="size-4" />
                      {t("active")}
                    </span>
                  )}
                </div>
                <span className="text-muted truncate text-sm">
                  {t("members", { count: cookbook.memberCount })}
                </span>
              </div>
              <Button size="sm" variant="tertiary" onPress={() => openCookbook(cookbook.id)}>
                {t("open")}
              </Button>
            </Card.Content>
          </Card>
        ))}
      </div>

      <div>
        <Button variant="secondary" onPress={() => router.push("/settings?tab=household")}>
          {t("manage")}
        </Button>
      </div>
    </div>
  );
}
