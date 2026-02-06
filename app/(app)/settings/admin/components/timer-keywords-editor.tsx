"use client";

import { useState, useEffect, useCallback } from "react";
import { Textarea, Button, Switch, Chip } from "@heroui/react";
import { ArrowPathIcon, CheckIcon, ExclamationTriangleIcon } from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";

interface TimerKeywordsEditorProps {
  enabled: boolean;
  keywords: string[];
  onUpdate: (config: {
    enabled: boolean;
    keywords: string[];
  }) => Promise<{ success: boolean; error?: string }>;
  onRestoreDefaults: () => Promise<{ success: boolean; error?: string }>;
}

export default function TimerKeywordsEditor({
  enabled,
  keywords,
  onUpdate,
  onRestoreDefaults,
}: TimerKeywordsEditorProps) {
  const t = useTranslations("settings.admin.contentDetection.timerKeywords");
  const tActions = useTranslations("common.actions");

  const [isEnabled, setIsEnabled] = useState(enabled);
  const [keywordsText, setKeywordsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Initialize text when keywords change
  useEffect(() => {
    setKeywordsText(keywords.join(", "));
    setIsEnabled(enabled);
    setIsDirty(false);
    setError(null);
  }, [enabled, keywords]);

  const handleEnabledChange = useCallback((newEnabled: boolean) => {
    setIsEnabled(newEnabled);
    setIsDirty(true);
  }, []);

  const handleTextChange = useCallback(
    (newText: string) => {
      setKeywordsText(newText);
      setIsDirty(true);
      setError(null);

      // Basic validation: check if not empty when enabled
      if (isEnabled && newText.trim() === "") {
        setError("Keywords cannot be empty when timer detection is enabled");
      }
    },
    [isEnabled]
  );

  const handleSave = useCallback(async () => {
    if (error) return;

    // Parse comma-separated keywords
    const parsedKeywords = keywordsText
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (isEnabled && parsedKeywords.length === 0) {
      setError("Please add at least one keyword");
      return;
    }

    setSaving(true);
    try {
      const result = await onUpdate({
        enabled: isEnabled,
        keywords: parsedKeywords,
      });

      if (result.success) {
        setIsDirty(false);
      } else if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [keywordsText, isEnabled, error, onUpdate]);

  const handleRestoreDefaults = useCallback(async () => {
    setSaving(true);
    try {
      const result = await onRestoreDefaults();

      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restore defaults");
    } finally {
      setSaving(false);
    }
  }, [onRestoreDefaults]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("enableToggle")}</span>
          {isDirty && (
            <Chip color="warning" size="sm" variant="flat">
              {t("unsavedChanges")}
            </Chip>
          )}
        </div>
        <Switch isSelected={isEnabled} onValueChange={handleEnabledChange} />
      </div>

      <p className="text-default-500 text-sm">{t("description")}</p>

      <Textarea
        value={keywordsText}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder={t("placeholder")}
        description={t("inputHelp")}
        minRows={3}
        isDisabled={!isEnabled || saving}
        isInvalid={!!error}
        errorMessage={error || undefined}
        classNames={{
          input: "font-mono text-sm",
        }}
      />

      {error && (
        <div className="text-danger flex items-center gap-2 text-sm">
          <ExclamationTriangleIcon className="h-4 w-4" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          color="warning"
          isDisabled={saving}
          startContent={<ArrowPathIcon className="h-5 w-5" />}
          variant="flat"
          onPress={handleRestoreDefaults}
        >
          {tActions("restoreDefaults")}
        </Button>

        <Button
          color="primary"
          isDisabled={!!error || !isDirty}
          isLoading={saving}
          startContent={<CheckIcon className="h-5 w-5" />}
          onPress={handleSave}
        >
          {tActions("save")}
        </Button>
      </div>
    </div>
  );
}
