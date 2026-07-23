"use client";

import { useEffect, useMemo, useState } from "react";
import { useHouseholdContext } from "@/context/household-context";
import { usePermissionsContext } from "@/context/permissions-context";
import { useRecipesContext } from "@/context/recipes-context";
import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";
import { ArrowDownTrayIcon, BookOpenIcon, SparklesIcon } from "@heroicons/react/16/solid";
import { Button, Label, Modal, TextArea, TextField, toast } from "@heroui/react";
import { useTranslations } from "next-intl";

import type { BulkImportResult } from "@norish/shared-react/hooks/recipes/dashboard";
import { MAX_BULK_IMPORT_URLS, parseBulkImportUrls } from "@norish/shared/lib/helpers";

interface ImportRecipeModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}
export default function ImportRecipeModal({ isOpen, onOpenChange }: ImportRecipeModalProps) {
  const t = useTranslations("common.import.url");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const tCookbook = useTranslations("navbar.cookbook");
  const { importRecipe, importRecipeWithAI, importRecipesFromUrls } = useRecipesContext();
  const { households, activeHouseholdId } = useHouseholdContext();
  const { isAIEnabled } = usePermissionsContext();
  const [importUrl, setImportUrl] = useState("");

  // BULK-01: the same input accepts one URL or many (newline / comma separated, or a
  // pasted blog index). Parse+dedup client-side with the SAME helper the server enforces,
  // so the detected count preview matches what would actually be enqueued.
  const parsed = useMemo(() => parseBulkImportUrls(importUrl), [importUrl]);
  const hasUrls = parsed.urls.length > 0;

  // The backend assigns the import to the user's ACTIVE cookbook (02-02); show
  // which cookbook that is so the destination is never a surprise.
  const activeCookbookName =
    households.find((cookbook) => cookbook.id === activeHouseholdId)?.name ??
    tCookbook("personal");

  function handleOpenChange(open: boolean) {
    if (!open) {
      setImportUrl("");
    }
    onOpenChange(open);
  }
  useEffect(() => {
    if (!isOpen || typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      return;
    }
    let isCancelled = false;

    async function fillUrlFromClipboard() {
      try {
        const clipboardText = (await navigator.clipboard.readText()).trim();

        if (!clipboardText) {
          return;
        }
        const parsedUrl = new URL(clipboardText);
        const isHttpUrl = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";

        if (isHttpUrl && !isCancelled) {
          setImportUrl((currentValue) =>
            currentValue.trim() === "" ? clipboardText : currentValue
          );
        }
      } catch {}
    }
    void fillUrlFromClipboard();

    return () => {
      isCancelled = true;
    };
  }, [isOpen]);

  function summarizeBulk(result: BulkImportResult, truncated: number) {
    const queued = result.items.filter((item) => item.status === "queued").length;
    const duplicate = result.items.filter((item) => item.status === "duplicate").length;
    const exists = result.items.filter((item) => item.status === "exists").length;

    const parts: string[] = [];

    if (duplicate > 0) parts.push(t("bulk.duplicateCount", { count: duplicate }));
    if (exists > 0) parts.push(t("bulk.existsCount", { count: exists }));
    if (truncated > 0) parts.push(t("bulk.skippedCount", { count: truncated, max: MAX_BULK_IMPORT_URLS }));

    toast(queued > 0 ? t("bulk.queuedCount", { count: queued }) : t("bulk.noneQueued"), {
      description: parts.length > 0 ? parts.join(" · ") : undefined,
      variant: queued > 0 ? "default" : "warning",
    });
  }

  async function submitImport(forceAI: boolean) {
    if (!hasUrls) return;

    try {
      if (parsed.urls.length === 1) {
        // Single URL: keep the existing optimistic single-import path unchanged.
        const [url] = parsed.urls;

        if (forceAI) {
          await importRecipeWithAI(url!);
        } else {
          await importRecipe(url!);
        }
      } else {
        // Many URLs: fan out over the bulk queue path and report per-item outcomes.
        const result = await importRecipesFromUrls(parsed.urls, forceAI || undefined);

        summarizeBulk(result, parsed.truncated);
      }

      onOpenChange(false);
      setImportUrl("");
    } catch (e) {
      onOpenChange(false);
      setImportUrl("");
      showSafeErrorToast({
        title: forceAI ? t("failedWithAI") : t("failed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error: e,
        context: forceAI ? "import-recipe-modal:import-ai" : "import-recipe-modal:import",
      });
    }
  }

  return (
    <Modal>
      <Modal.Backdrop className="z-[1099]" isOpen={isOpen} onOpenChange={handleOpenChange}>
        <Modal.Container className="z-[1100]" size="md">
          <Modal.Dialog>
            {() => (
              <>
                <Modal.CloseTrigger />
                <Modal.Header className="flex flex-col gap-1">{t("title")}</Modal.Header>
                <Modal.Body>
                  <TextField fullWidth value={importUrl} variant="secondary" onChange={setImportUrl}>
                    <Label>{t("bulkLabel")}</Label>
                    <TextArea fullWidth placeholder={t("bulkPlaceholder")} rows={5} />
                  </TextField>
                  <p className="text-muted text-xs">
                    {t("detected", { count: parsed.urls.length })}
                    {parsed.truncated > 0
                      ? ` · ${t("overCap", { max: MAX_BULK_IMPORT_URLS, truncated: parsed.truncated })}`
                      : ""}
                  </p>
                  <p className="text-muted flex items-center gap-1.5 text-sm">
                    <BookOpenIcon className="size-4 shrink-0" />
                    <span>{t("targetCookbook", { cookbook: activeCookbookName })}</span>
                  </p>
                </Modal.Body>
                <Modal.Footer>
                  {isAIEnabled && (
                    <Button
                      isDisabled={!hasUrls}
                      variant="secondary"
                      onPress={() => submitImport(true)}
                    >
                      {<SparklesIcon className="h-4 w-4" />}
                      {tActions("aiImport")}
                    </Button>
                  )}
                  <Button
                    isDisabled={!hasUrls}
                    variant="primary"
                    onPress={() => submitImport(false)}
                  >
                    {<ArrowDownTrayIcon className="h-4 w-4" />}
                    {tActions("import")}
                  </Button>
                </Modal.Footer>
              </>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
