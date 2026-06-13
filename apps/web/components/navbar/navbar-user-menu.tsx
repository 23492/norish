"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Avatar } from "@heroui/avatar";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from "@heroui/dropdown";
import { Button } from "@heroui/react";
import { useTranslations } from "next-intl";
import { useUserAvatar } from "@norish/shared-react/hooks";
import { cssButtonPill, cssButtonPillDanger } from "@norish/web/config/css-tokens";

import { ThemeSwitch } from "./theme-switch";

import { useVersionQuery } from "@/hooks/config";
import { useUserContext } from "@/context/user-context";
import { useHouseholdContext } from "@/context/household-context";
import { LanguageSwitch } from "@/components/shared/language-switch";
import ImportRecipeModal from "@/components/shared/import-recipe-modal";

type TriggerVariant = "avatar" | "ellipsis";

interface NavbarUserMenuProps {
  trigger?: TriggerVariant;
}

export default function NavbarUserMenu({ trigger = "avatar" }: NavbarUserMenuProps) {
  const t = useTranslations("navbar.userMenu");
  const tCookbook = useTranslations("navbar.cookbook");
  const { user, userMenuOpen: _userMenuOpen, setUserMenuOpen, signOut } = useUserContext();
  const { households, activeHouseholdId, switchActive } = useHouseholdContext();
  const router = useRouter();
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [imageError, setImageError] = useState(false);
  const { currentVersion, latestVersion, updateAvailable, releaseUrl } = useVersionQuery();
  const { avatarSrc, fallbackStyle } = useUserAvatar({
    image: user?.image,
    fallbackSeed: user?.id || user?.email || user?.name || "U",
    disabled: imageError,
  });

  const handleImageError = () => {
    setImageError(true);
  };

  if (!user) return null;

  return (
    <>
      <Dropdown placement="bottom-end" onOpenChange={setUserMenuOpen}>
        <DropdownTrigger>
          {trigger === "avatar" ? (
            <button aria-label="Open user menu" className="relative rounded-full" type="button">
              <Avatar
                className={`isBordered h-13 w-13 cursor-pointer border border-black/30 text-lg font-semibold dark:border-white/25 ${avatarSrc ? "bg-white dark:bg-black" : ""}`}
                imgProps={{
                  onError: handleImageError,
                }}
                name={user?.name || user?.email || "U"}
                src={avatarSrc}
                style={avatarSrc ? undefined : fallbackStyle}
              />
              {updateAvailable && (
                <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                  <span className="bg-primary absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
                  <span className="bg-primary relative inline-flex h-3 w-3 rounded-full" />
                </span>
              )}
            </button>
          ) : (
            <Button
              isIconOnly
              className="bg-default-100 text-foreground"
              radius="full"
              size="sm"
              variant="flat"
            >
              <EllipsisVerticalIcon className="size-5" />
            </Button>
          )}
        </DropdownTrigger>

        <DropdownMenu aria-label="User menu" className="min-w-[260px]">
          {user && (
            <DropdownItem
              key="user"
              isReadOnly
              className="flex cursor-default flex-col items-start gap-1 data-[focus=true]:bg-transparent data-[hover=true]:bg-transparent"
            >
              <span className="text-sm font-semibold">{user.name}</span>
              <span className="text-default-500 text-xs"> ({user.email})</span>
            </DropdownItem>
          )}

          <DropdownItem key="language" isReadOnly className={`py-3 ${cssButtonPill}`}>
            <LanguageSwitch />
          </DropdownItem>

          <DropdownSection showDivider title={tCookbook("label")}>
            {[
              <DropdownItem
                key="cookbook-personal"
                className={`py-3 ${cssButtonPill}`}
                endContent={
                  activeHouseholdId === null ? (
                    <CheckIcon aria-label={tCookbook("active")} className="size-5 text-primary" />
                  ) : null
                }
                startContent={
                  <span className="text-default-500">
                    <BookOpenIcon className="size-5" />
                  </span>
                }
                textValue={tCookbook("personal")}
                onPress={() => switchActive(null)}
              >
                <div className="flex flex-col items-start">
                  <span className="text-base leading-tight font-medium">
                    {tCookbook("personal")}
                  </span>
                  <span className="text-default-500 text-xs leading-tight">
                    {tCookbook("personalDescription")}
                  </span>
                </div>
              </DropdownItem>,
              ...households.map((cookbook) => (
                <DropdownItem
                  key={`cookbook-${cookbook.id}`}
                  className={`py-3 ${cssButtonPill}`}
                  endContent={
                    cookbook.id === activeHouseholdId ? (
                      <CheckIcon aria-label={tCookbook("active")} className="size-5 text-primary" />
                    ) : null
                  }
                  startContent={
                    <span className="text-default-500">
                      <UserGroupIcon className="size-5" />
                    </span>
                  }
                  textValue={cookbook.name}
                  onPress={() => switchActive(cookbook.id)}
                >
                  <div className="flex flex-col items-start">
                    <span className="text-base leading-tight font-medium">{cookbook.name}</span>
                    <span className="text-default-500 text-xs leading-tight">
                      {tCookbook("members", { count: cookbook.memberCount })}
                    </span>
                  </div>
                </DropdownItem>
              )),
              <DropdownItem
                key="cookbook-manage"
                className={`py-3 ${cssButtonPill}`}
                href="/settings?tab=household"
                startContent={
                  <span className="text-default-500">
                    <PlusIcon className="size-5" />
                  </span>
                }
                onPress={() => setUserMenuOpen(false)}
              >
                <span className="text-base leading-tight font-medium">{tCookbook("manage")}</span>
              </DropdownItem>,
            ]}
          </DropdownSection>

          <DropdownItem
            key="create-recipe"
            className={`py-3 ${cssButtonPill}`}
            startContent={
              <span className="text-default-500">
                <PlusIcon className="size-5" />
              </span>
            }
            onPress={() => {
              setUserMenuOpen(false);
              router.push("/recipes/new");
            }}
          >
            <div className="flex flex-col items-start">
              <span className="text-base leading-tight font-medium">{t("newRecipe.title")}</span>
              <span className="text-default-500 text-xs leading-tight">
                {t("newRecipe.description")}
              </span>
            </div>
          </DropdownItem>

          <DropdownItem
            key="import-url"
            className={`py-3 ${cssButtonPill}`}
            startContent={
              <span className="text-default-500">
                <ArrowDownTrayIcon className="size-5" />
              </span>
            }
            onPress={() => {
              setUserMenuOpen(false);
              setShowUrlModal(true);
            }}
          >
            <div className="flex flex-col items-start">
              <span className="text-base leading-tight font-medium">{t("importUrl.title")}</span>
              <span className="text-default-500 text-xs leading-tight">
                {t("importUrl.description")}
              </span>
            </div>
          </DropdownItem>

          <DropdownItem key="theme" isReadOnly className={`py-3 ${cssButtonPill}`}>
            <ThemeSwitch />
          </DropdownItem>
          <DropdownItem
            key="settings"
            className={`py-3 ${cssButtonPill}`}
            href="/settings?tab=user"
            startContent={
              <span className="text-default-500">
                <Cog6ToothIcon className="size-5" />
              </span>
            }
            onPress={() => setUserMenuOpen(false)}
          >
            <div className="flex flex-col items-start">
              <span className="text-base leading-tight font-medium">{t("settings.title")}</span>
              <span className="text-default-500 text-xs leading-tight">
                {t("settings.description")}
              </span>
            </div>
          </DropdownItem>

          <DropdownItem
            key="logout"
            className={`text-danger-400 py-3 ${cssButtonPillDanger}`}
            startContent={
              <span className="text-danger-400">
                <ArrowLeftStartOnRectangleIcon className="size-5" />
              </span>
            }
            onPress={() => {
              setUserMenuOpen(false);
              signOut();
            }}
          >
            <span className="text-base font-medium">{t("logout")}</span>
          </DropdownItem>

          {/* Version info - discrete footer */}
          <DropdownItem
            key="version"
            className="border-default-100 cursor-default border-t pt-2 data-[hover=true]:bg-transparent"
            isReadOnly={!updateAvailable}
            textValue="Version"
          >
            <div className="text-default-400 flex items-center justify-end gap-2 text-xs">
              {updateAvailable && releaseUrl && latestVersion && (
                <a
                  className="text-primary hover:text-primary-600 hover:underline"
                  href={releaseUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t("version.updateAvailable", { version: latestVersion })}
                </a>
              )}
              <span>v{currentVersion ?? "..."}</span>
            </div>
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>

      {/* Import from URL Modal */}
      <ImportRecipeModal isOpen={showUrlModal} onOpenChange={setShowUrlModal} />
    </>
  );
}
