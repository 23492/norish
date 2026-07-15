"use client";

import type { PermissionLevel } from "@norish/config/zod/server-config";

import { useState } from "react";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { Card, ListBox, Select } from "@heroui/react";
import { useTranslations } from "next-intl";

import { useHouseholdSettingsContext } from "../context";

type PolicyAction = "view" | "edit" | "delete";

// Per-cookbook policy card (mirrors the server-admin permission-policy-card).
// DECISION #5: the per-cookbook `view` may only be `household` or `owner` — a
// per-cookbook `view = everyone` is NOT offered here (only the global default may
// be everyone). edit/delete keep all three levels.
const VIEW_OPTIONS: { value: "household" | "owner"; labelKey: string; descriptionKey: string }[] = [
  { value: "household", labelKey: "levels.household", descriptionKey: "levels.householdDescription" },
  { value: "owner", labelKey: "levels.owner", descriptionKey: "levels.ownerDescription" },
];

const EDIT_OPTIONS: { value: PermissionLevel; labelKey: string; descriptionKey: string }[] = [
  { value: "everyone", labelKey: "levels.everyone", descriptionKey: "levels.everyoneDescription" },
  { value: "household", labelKey: "levels.household", descriptionKey: "levels.householdDescription" },
  { value: "owner", labelKey: "levels.owner", descriptionKey: "levels.ownerDescription" },
];

export default function HouseholdPermissionPolicyCard() {
  const t = useTranslations("settings.household.permissions");
  const { household, currentUserId, setPolicy } = useHouseholdSettingsContext();
  const [saving, setSaving] = useState<PolicyAction | null>(null);

  // Only the cookbook admin sees + edits the policy card.
  const isAdmin =
    !!household &&
    !!currentUserId &&
    household.users.some((u) => u.id === currentUserId && u.isAdmin);

  // The policy fields live on the admin DTO only.
  if (!household || !isAdmin || !("viewPolicy" in household)) {
    return null;
  }

  const view = household.viewPolicy === "everyone" ? "household" : household.viewPolicy;
  const { editPolicy, deletePolicy, version } = household;

  const handleChange = (action: PolicyAction, value: PermissionLevel) => {
    setSaving(action);
    try {
      const next = {
        view: (action === "view" ? value : view) as "household" | "owner",
        edit: action === "edit" ? value : editPolicy,
        delete: action === "delete" ? value : deletePolicy,
      };

      setPolicy(household.id, next, version);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <Card.Header>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheckIcon className="h-5 w-5" />
          {t("title")}
        </h2>
      </Card.Header>
      <Card.Content className="gap-6">
        <p className="text-default-500 text-base">{t("description")}</p>

        <div className="flex flex-col gap-4">
          {/* View Policy (household | owner only) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{t("viewRecipes")}</span>
              <span className="text-default-500 text-base">{t("viewDescription")}</span>
            </div>
            <Select
              aria-label={t("viewRecipes")}
              className="w-full sm:w-48"
              isDisabled={saving !== null}
              selectedKey={view}
              size="sm"
              onSelectionChange={(key) => {
                if (key) handleChange("view", key as PermissionLevel);
              }}
            >
              <Select.Trigger className="bg-content2">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {VIEW_OPTIONS.map((option) => (
                    <ListBox.Item
                      key={option.value}
                      id={option.value}
                      textValue={t(option.labelKey)}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{t(option.labelKey)}</span>
                        <span className="text-default-400 text-xs">
                          {t(option.descriptionKey)}
                        </span>
                      </div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {/* Edit Policy */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{t("editRecipes")}</span>
              <span className="text-default-500 text-base">{t("editDescription")}</span>
            </div>
            <Select
              aria-label={t("editRecipes")}
              className="w-full sm:w-48"
              isDisabled={saving !== null}
              selectedKey={editPolicy}
              size="sm"
              onSelectionChange={(key) => {
                if (key) handleChange("edit", key as PermissionLevel);
              }}
            >
              <Select.Trigger className="bg-content2">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {EDIT_OPTIONS.map((option) => (
                    <ListBox.Item
                      key={option.value}
                      id={option.value}
                      textValue={t(option.labelKey)}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{t(option.labelKey)}</span>
                        <span className="text-default-400 text-xs">
                          {t(option.descriptionKey)}
                        </span>
                      </div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          {/* Delete Policy */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{t("deleteRecipes")}</span>
              <span className="text-default-500 text-base">{t("deleteDescription")}</span>
            </div>
            <Select
              aria-label={t("deleteRecipes")}
              className="w-full sm:w-48"
              isDisabled={saving !== null}
              selectedKey={deletePolicy}
              size="sm"
              onSelectionChange={(key) => {
                if (key) handleChange("delete", key as PermissionLevel);
              }}
            >
              <Select.Trigger className="bg-content2">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {EDIT_OPTIONS.map((option) => (
                    <ListBox.Item
                      key={option.value}
                      id={option.value}
                      textValue={t(option.labelKey)}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{t(option.labelKey)}</span>
                        <span className="text-default-400 text-xs">
                          {t(option.descriptionKey)}
                        </span>
                      </div>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>

        <div className="bg-content2 text-default-600 mt-2 rounded-lg p-3 text-base">
          {t("note")}
        </div>
      </Card.Content>
    </Card>
  );
}
