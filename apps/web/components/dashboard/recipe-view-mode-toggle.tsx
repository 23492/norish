"use client";

import type { RecipeDashboardViewMode } from "@/hooks/use-recipe-dashboard-view-mode";
import type { Key } from "react";
import { useRecipeDashboardViewMode } from "@/hooks/use-recipe-dashboard-view-mode";
import { ListBulletIcon, Squares2X2Icon } from "@heroicons/react/20/solid";
import { ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useTranslations } from "next-intl";

function toRecipeDashboardViewMode(key: Key): RecipeDashboardViewMode {
  return key === "list" ? "list" : "grid";
}

export default function RecipeViewModeToggle() {
  const t = useTranslations("recipes.dashboard.viewMode");
  const [viewMode, setViewMode] = useRecipeDashboardViewMode();

  return (
    <ToggleButtonGroup
      aria-label={t("label")}
      className="shrink-0"
      disallowEmptySelection
      selectedKeys={[viewMode]}
      selectionMode="single"
      size="sm"
      onSelectionChange={(keys) => {
        const [key] = Array.from(keys);

        if (key) setViewMode(toRecipeDashboardViewMode(key));
      }}
    >
      <ToggleButton
        aria-label={t("grid")}
        className="min-w-8 px-2.5 sm:min-w-16"
        id="grid"
        title={t("grid")}
      >
        <Squares2X2Icon className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">{t("grid")}</span>
      </ToggleButton>
      <ToggleButton
        aria-label={t("list")}
        className="min-w-8 px-2.5 sm:min-w-16"
        id="list"
        title={t("list")}
      >
        <ToggleButtonGroup.Separator />
        <ListBulletIcon className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">{t("list")}</span>
      </ToggleButton>
    </ToggleButtonGroup>
  );
}
