"use client";

import { useEffect, useState } from "react";
import SettingsSwitch from "@/app/(app)/settings/components/settings-switch";
import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";
import { ChevronDownIcon } from "@heroicons/react/16/solid";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";
import { Button, Card, Label, ListBox, Popover, Select, Separator, toast } from "@heroui/react";
import { useTranslations } from "next-intl";

import { useAdminSettingsContext } from "../context";
import { UnsavedChangesChip } from "./unsaved-changes-chip";

export default function GeneralCard() {
  const t = useTranslations("settings.admin.general");
  const tErrors = useTranslations("common.errors");
  const { registrationEnabled, updateRegistration, localeConfig, updateLocaleConfig, isLoading } =
    useAdminSettingsContext();

  // Local state for locale config form
  const [enabledLocales, setEnabledLocales] = useState<string[]>([]);
  const [defaultLocale, setDefaultLocale] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  // Initialize local state from config
  useEffect(() => {
    if (localeConfig) {
      const enabled = Object.entries(localeConfig.locales)
        .filter(([_, entry]) => entry.enabled)
        .map(([code]) => code);
      setEnabledLocales(enabled);
      setDefaultLocale(localeConfig.defaultLocale);
    }
  }, [localeConfig]);
  const handleRegistrationToggle = async (checked: boolean) => {
    await updateRegistration(checked);
  };
  const handleEnabledLocalesChange = (values: string[]) => {
    // Ensure at least one locale is enabled
    if (values.length === 0) {
      toast(t("atLeastOneLocale"), {
        variant: "warning",
      });
      return;
    }
    setEnabledLocales(values);

    // If default locale is no longer enabled, switch to first enabled
    if (!values.includes(defaultLocale)) {
      const firstEnabled = values[0];
      if (firstEnabled) {
        setDefaultLocale(firstEnabled);
      }
    }
  };
  const handleLocaleToggle = (code: string, enabled: boolean) => {
    if (enabled) {
      handleEnabledLocalesChange([...enabledLocales, code]);
    } else {
      handleEnabledLocalesChange(enabledLocales.filter((c) => c !== code));
    }
  };
  const handleSaveLocales = async () => {
    if (enabledLocales.length === 0) {
      toast(t("atLeastOneLocale"), {
        variant: "warning",
      });
      return;
    }
    setIsSaving(true);
    try {
      const result = await updateLocaleConfig({
        defaultLocale,
        enabledLocales,
      });
      if (result.success) {
        toast(t("localesSaved"), {
          variant: "success",
        });
      } else {
        showSafeErrorToast({
          title: t("localesError"),
          description: tErrors("technicalDetails"),
          color: "danger",
          error: result.error,
          context: "admin-general:save-locales",
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Check if locale config has changed from server state
  const hasLocaleChanges = (() => {
    if (!localeConfig) return false;
    const serverEnabled = Object.entries(localeConfig.locales)
      .filter(([_, entry]) => entry.enabled)
      .map(([code]) => code)
      .sort();
    const localEnabled = [...enabledLocales].sort();
    if (serverEnabled.length !== localEnabled.length) return true;
    if (!serverEnabled.every((v, i) => v === localEnabled[i])) return true;
    if (localeConfig.defaultLocale !== defaultLocale) return true;
    return false;
  })();

  // Get all locales for display
  const allLocales = localeConfig
    ? Object.entries(localeConfig.locales).map(([code, entry]) => ({
        code,
        name: entry.name,
      }))
    : [];

  // Filter enabled locales for default selector
  const enabledLocaleOptions = allLocales.filter((l) => enabledLocales.includes(l.code));
  return (
    <Card>
      <Card.Header>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Cog6ToothIcon className="h-5 w-5" />
          {t("title")}
        </h2>
      </Card.Header>
      <Card.Content className="flex flex-col gap-6">
        {/* Registration Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t("allowRegistration")}</span>
            <span className="text-muted text-base">{t("registrationDescription")}</span>
          </div>
          <SettingsSwitch
            color="success"
            isDisabled={isLoading}
            isSelected={registrationEnabled ?? false}
            onValueChange={handleRegistrationToggle}
          />
        </div>

        <Separator />

        {/* Locale Configuration */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2 font-medium">
              {t("locales")}
              {hasLocaleChanges && <UnsavedChangesChip />}
            </span>
            <span className="text-muted text-base">{t("localesDescription")}</span>
          </div>

          <Popover>
            <Popover.Trigger>
              <Button
                className="max-w-xs justify-between"
                isDisabled={isLoading || isSaving}
                variant="secondary"
              >
                <span className="truncate">
                  {enabledLocaleOptions.map((l) => l.name).join(", ") || t("locales")}
                </span>
                {<ChevronDownIcon className="h-4 w-4 shrink-0" />}
              </Button>
            </Popover.Trigger>
            <Popover.Content className="w-64 items-stretch p-0" placement="bottom-start">
              <Popover.Dialog>
                <div className="flex w-full flex-col">
                  {allLocales.map((locale) => (
                    <div
                      key={locale.code}
                      className="hover:bg-surface-secondary flex w-full items-center justify-between px-4 py-3"
                    >
                      <span className="flex-1 text-sm">{locale.name}</span>
                      <SettingsSwitch
                        isDisabled={isLoading || isSaving}
                        isSelected={enabledLocales.includes(locale.code)}
                        size="sm"
                        onValueChange={(checked) => handleLocaleToggle(locale.code, checked)}
                      />
                    </div>
                  ))}
                </div>
              </Popover.Dialog>
            </Popover.Content>
          </Popover>
        </div>

        {/* Default Locale Selector */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t("defaultLocale")}</span>
            <span className="text-muted text-base">{t("defaultLocaleDescription")}</span>
          </div>

          <Select
            variant="secondary"
            className="max-w-xs"
            isDisabled={isLoading || isSaving}
            placeholder={t("defaultLocale")}
            value={defaultLocale || null}
            onChange={(selected) => {
              if (typeof selected === "string") {
                setDefaultLocale(selected);
              }
            }}
          >
            <Label>{t("defaultLocale")}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {enabledLocaleOptions.map((locale) => (
                  <ListBox.Item key={locale.code} id={locale.code} textValue={locale.name}>
                    {locale.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            isDisabled={isLoading || !hasLocaleChanges}
            onPress={handleSaveLocales}
            variant="primary"
            isPending={isSaving}
          >
            {t("saveLocales")}
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
