"use client";

import React, { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import ImportRecipeModal from "@/components/shared/import-recipe-modal";
import { LanguageSwitchContent } from "@/components/shared/language-switch";
import UserAvatar from "@/components/shared/user-avatar";
import { useHouseholdContext } from "@/context/household-context";
import { useUserContext } from "@/context/user-context";
import { useVersionQuery } from "@/hooks/config";
import { useLanguageSwitch } from "@/hooks/user/use-language-switch";
import {
  ArrowDownTrayIcon,
  ArrowLeftStartOnRectangleIcon,
  BookOpenIcon,
  CheckIcon,
  Cog6ToothIcon,
  EllipsisVerticalIcon,
  PlusIcon,
  UserGroupIcon,
} from "@heroicons/react/16/solid";
import { Button, Dropdown, Label } from "@heroui/react";
import { useTranslations } from "next-intl";

import { cssButtonPill, cssButtonPillDanger } from "@norish/web/config/css-tokens";

import { ThemeSwitchContent, useThemeSwitch } from "./theme-switch";

type TriggerVariant = "avatar" | "ellipsis";
interface NavbarUserMenuProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: TriggerVariant;
}
export default function NavbarUserMenu({
  isOpen,
  onOpenChange,
  trigger = "avatar",
}: NavbarUserMenuProps) {
  const t = useTranslations("navbar.userMenu");
  const tCookbook = useTranslations("navbar.cookbook");
  const { user, signOut } = useUserContext();
  const { households, activeHouseholdId, switchActive } = useHouseholdContext();
  const router = useRouter();
  const [localOpen, setLocalOpen] = useState(false);
  const [showUrlModal, setShowUrlModal] = useState(false);
  const themeSwitch = useThemeSwitch();
  const languageSwitch = useLanguageSwitch();
  const { currentVersion, latestVersion, updateAvailable, releaseUrl } = useVersionQuery();
  const menuOpen = isOpen ?? localOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setLocalOpen(open);
      onOpenChange?.(open);
    },
    [onOpenChange]
  );

  if (!user) return null;

  return (
    <>
      <Dropdown isOpen={menuOpen} onOpenChange={handleOpenChange}>
        {trigger === "avatar" ? (
          <Button
            isIconOnly
            aria-label="Open user menu"
            className="relative h-13 w-13 rounded-full p-0"
            variant="ghost"
          >
            <UserAvatar
              className="size-13 cursor-pointer text-lg"
              email={user.email}
              image={user.image}
              name={user.name}
              userId={user.id}
            />
            {updateAvailable && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="bg-accent absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                <span className="bg-accent relative inline-flex h-3 w-3 rounded-full" />
              </span>
            )}
          </Button>
        ) : (
          <Button
            isIconOnly
            className="bg-surface-secondary text-foreground rounded-full"
            size="sm"
            variant="tertiary"
          >
            <EllipsisVerticalIcon className="size-5" />
          </Button>
        )}

        <Dropdown.Popover
          className="bg-overlay w-[min(22rem,calc(100vw-1rem))]"
          placement="bottom end"
        >
          <div className="border-border px-3 pt-3 pb-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{user.name}</span>
              <span className="text-muted truncate text-xs">{user.email}</span>
            </div>
          </div>
          <Dropdown.Menu aria-label="User menu" className="w-full">
            <Dropdown.Item
              key="language"
              className={`py-3 ${cssButtonPill}`}
              id="language"
              textValue="Language"
              onPress={languageSwitch.cycleLocale}
            >
              <LanguageSwitchContent {...languageSwitch} />
            </Dropdown.Item>

            <Dropdown.Section title={tCookbook("label")}>
              <Dropdown.Item
                key="cookbook-personal"
                className={`py-3 ${cssButtonPill}`}
                id="cookbook-personal"
                textValue={tCookbook("personal")}
                onPress={() => {
                  switchActive(null);
                  handleOpenChange(false);
                }}
              >
                <span className="text-muted">
                  <BookOpenIcon className="size-5" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <Label className="text-base leading-tight font-medium">
                    {tCookbook("personal")}
                  </Label>
                  <span className="text-muted text-xs leading-tight">
                    {tCookbook("personalDescription")}
                  </span>
                </div>
                {activeHouseholdId === null && (
                  <CheckIcon aria-label={tCookbook("active")} className="size-5 text-accent" />
                )}
              </Dropdown.Item>
              {households.map((cookbook) => (
                <Dropdown.Item
                  key={`cookbook-${cookbook.id}`}
                  className={`py-3 ${cssButtonPill}`}
                  id={`cookbook-${cookbook.id}`}
                  textValue={cookbook.name}
                  onPress={() => {
                    switchActive(cookbook.id);
                    handleOpenChange(false);
                  }}
                >
                  <span className="text-muted">
                    <UserGroupIcon className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col items-start">
                    <Label className="text-base leading-tight font-medium">{cookbook.name}</Label>
                    <span className="text-muted text-xs leading-tight">
                      {tCookbook("members", { count: cookbook.memberCount })}
                    </span>
                  </div>
                  {cookbook.id === activeHouseholdId && (
                    <CheckIcon aria-label={tCookbook("active")} className="size-5 text-accent" />
                  )}
                </Dropdown.Item>
              ))}
            </Dropdown.Section>

            <Dropdown.Item
              key="create-recipe"
              className={`py-3 ${cssButtonPill}`}
              id="create-recipe"
              textValue={t("newRecipe.title")}
              onPress={() => {
                handleOpenChange(false);
                router.push("/recipes/new");
              }}
            >
              <span className="text-muted">
                <PlusIcon className="size-5" />
              </span>
              <div className="flex flex-col items-start">
                <Label className="text-base leading-tight font-medium">
                  {t("newRecipe.title")}
                </Label>
                <span className="text-muted text-xs leading-tight">
                  {t("newRecipe.description")}
                </span>
              </div>
            </Dropdown.Item>

            <Dropdown.Item
              key="import-url"
              className={`py-3 ${cssButtonPill}`}
              id="import-url"
              textValue={t("importUrl.title")}
              onPress={() => {
                handleOpenChange(false);
                setShowUrlModal(true);
              }}
            >
              <span className="text-muted">
                <ArrowDownTrayIcon className="size-5" />
              </span>
              <div className="flex flex-col items-start">
                <Label className="text-base leading-tight font-medium">
                  {t("importUrl.title")}
                </Label>
                <span className="text-muted text-xs leading-tight">
                  {t("importUrl.description")}
                </span>
              </div>
            </Dropdown.Item>

            <Dropdown.Item
              key="theme"
              className={`py-3 ${cssButtonPill}`}
              id="theme"
              textValue="Theme"
              onPress={themeSwitch.cycleTheme}
            >
              <ThemeSwitchContent {...themeSwitch} />
            </Dropdown.Item>
            <Dropdown.Item
              key="settings"
              className={`py-3 ${cssButtonPill}`}
              href="/settings?tab=user"
              id="settings"
              textValue={t("settings.title")}
              onPress={() => handleOpenChange(false)}
            >
              <span className="text-muted">
                <Cog6ToothIcon className="size-5" />
              </span>
              <div className="flex flex-col items-start">
                <Label className="text-base leading-tight font-medium">{t("settings.title")}</Label>
                <span className="text-muted text-xs leading-tight">
                  {t("settings.description")}
                </span>
              </div>
            </Dropdown.Item>

            <Dropdown.Item
              key="logout"
              className={`text-danger py-3 ${cssButtonPillDanger}`}
              id="logout"
              textValue={t("logout")}
              variant="danger"
              onPress={() => {
                handleOpenChange(false);
                signOut();
              }}
            >
              <span className="text-danger">
                <ArrowLeftStartOnRectangleIcon className="size-5" />
              </span>
              <Label className="text-danger text-base font-medium">{t("logout")}</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
          <div className="border-border text-muted mt-2 flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5 border-t px-4 py-3 text-xs">
            {updateAvailable && releaseUrl && latestVersion && (
              <a
                className="text-accent min-w-0 truncate hover:underline"
                href={releaseUrl}
                rel="noopener noreferrer"
                target="_blank"
                onClick={(e) => e.stopPropagation()}
              >
                {t("version.updateAvailable", {
                  version: latestVersion,
                })}
              </a>
            )}
            <span className="shrink-0">v{currentVersion ?? "..."}</span>
          </div>
        </Dropdown.Popover>
      </Dropdown>

      {/* Import from URL Modal */}
      <ImportRecipeModal isOpen={showUrlModal} onOpenChange={setShowUrlModal} />
    </>
  );
}
