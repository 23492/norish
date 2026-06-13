"use client";

import { useEffect, useState } from "react";
import { ArrowDownTrayIcon, BookOpenIcon, SparklesIcon } from "@heroicons/react/16/solid";
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
import { useTranslations } from "next-intl";

import { useHouseholdContext } from "@/context/household-context";
import { usePermissionsContext } from "@/context/permissions-context";
import { useRecipesContext } from "@/context/recipes-context";
import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";

interface ImportRecipeModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ImportRecipeModal({ isOpen, onOpenChange }: ImportRecipeModalProps) {
  const t = useTranslations("common.import.url");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const tCookbook = useTranslations("navbar.cookbook");
  const { importRecipe, importRecipeWithAI } = useRecipesContext();
  const { households, activeHouseholdId } = useHouseholdContext();
  const { isAIEnabled } = usePermissionsContext();
  const [importUrl, setImportUrl] = useState("");

  // The backend assigns the import to the user's ACTIVE cookbook (02-02); show
  // which cookbook that is so the destination is never a surprise.
  const activeCookbookName =
    households.find((cookbook) => cookbook.id === activeHouseholdId)?.name ??
    tCookbook("personal");

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

  async function handleImportFromUrl() {
    if (importUrl.trim() === "") return;

    try {
      await importRecipe(importUrl);
      onOpenChange(false);
      setImportUrl("");
    } catch (e) {
      onOpenChange(false);
      setImportUrl("");
      showSafeErrorToast({
        title: t("failed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error: e,
        context: "import-recipe-modal:import",
      });
    }
  }

  async function handleAIImport() {
    if (importUrl.trim() === "") return;

    try {
      await importRecipeWithAI(importUrl);
      onOpenChange(false);
      setImportUrl("");
    } catch (e) {
      onOpenChange(false);
      setImportUrl("");
      showSafeErrorToast({
        title: t("failedWithAI"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error: e,
        context: "import-recipe-modal:import-ai",
      });
    }
  }

  return (
    <Modal
      classNames={{ wrapper: "z-[1100]", backdrop: "z-[1099]" }}
      isOpen={isOpen}
      size="md"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">{t("title")}</ModalHeader>
            <ModalBody>
              <Input
                label={t("label")}
                placeholder={t("placeholder")}
                type="url"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
            </ModalBody>
            <ModalFooter className="flex-col items-stretch gap-3">
              <p className="text-default-500 flex items-center gap-1.5 text-xs">
                <BookOpenIcon className="size-4 shrink-0" />
                <span>{t("targetCookbook", { cookbook: activeCookbookName })}</span>
              </p>
              <div className="flex justify-end gap-2">
                {isAIEnabled && (
                  <Button
                    className="bg-gradient-to-r from-rose-400 via-fuchsia-500 to-indigo-500 text-white hover:brightness-110"
                    startContent={<SparklesIcon className="h-4 w-4" />}
                    onPress={handleAIImport}
                  >
                    {tActions("aiImport")}
                  </Button>
                )}
                <Button
                  color="primary"
                  startContent={<ArrowDownTrayIcon className="h-4 w-4" />}
                  onPress={handleImportFromUrl}
                >
                  {tActions("import")}
                </Button>
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
