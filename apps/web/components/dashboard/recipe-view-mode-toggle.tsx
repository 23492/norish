"use client";

import type { RecipeDashboardViewMode } from "@/hooks/use-recipe-dashboard-view-mode";
import type { Key } from "react";
import { useRecipeDashboardViewMode } from "@/hooks/use-recipe-dashboard-view-mode";
import { ListBulletIcon, Squares2X2Icon } from "@heroicons/react/20/solid";
import { Segment } from "@heroui-pro/react";
import { useTranslations } from "next-intl";

function toRecipeDashboardViewMode(key: Key): RecipeDashboardViewMode {
  return key === "list" ? "list" : "grid";
}

export default function RecipeViewModeToggle() {
  const t = useTranslations("recipes.dashboard.viewMode");
  const [viewMode, setViewMode] = useRecipeDashboardViewMode();

  return (
    <Segment
      aria-label={t("label")}
      selectedKey={viewMode}
      size="sm"
      variant="ghost"
      onSelectionChange={(key) => setViewMode(toRecipeDashboardViewMode(key))}
    >
      <Segment.Item aria-label={t("grid")} className="w-9 justify-center px-0" id="grid">
        <Squares2X2Icon className="h-4 w-4" />
        <span className="sr-only">{t("grid")}</span>
      </Segment.Item>
      <Segment.Item aria-label={t("list")} className="w-9 justify-center px-0" id="list">
        <ListBulletIcon className="h-4 w-4" />
        <span className="sr-only">{t("list")}</span>
      </Segment.Item>
    </Segment>
  );
}
