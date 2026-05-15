"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { usePermissionsContext } from "@/context/permissions-context";
import { useRecipesMutations } from "@/hooks/recipes";
import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";
import { ArrowDownTrayIcon, SparklesIcon } from "@heroicons/react/16/solid";
import { Button, Modal, TextArea, toast } from "@heroui/react";
import { useTranslations } from "next-intl";

import { MAX_RECIPE_PASTE_CHARS } from "@norish/shared/contracts/uploads";

interface ImportFromPasteModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}
export default function ImportFromPasteModal({ isOpen, onOpenChange }: ImportFromPasteModalProps) {
  const t = useTranslations("common.import.paste");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const router = useRouter();
  const { isAIEnabled } = usePermissionsContext();
  const { importRecipeFromPaste, importRecipeFromPasteWithAI } = useRecipesMutations();
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleImport = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIsSubmitting(true);
    try {
      importRecipeFromPaste(trimmed);
      toast(t("importing"), {
        description: t("inProgress"),
        variant: "default",
      });
      onOpenChange(false);
      setText("");
      router.push("/");
    } catch (error) {
      showSafeErrorToast({
        title: t("failed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error,
        context: "import-from-paste-modal:import",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [importRecipeFromPaste, onOpenChange, router, t, tErrors, text]);
  const handleAIImport = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_RECIPE_PASTE_CHARS) {
      toast(t("tooLarge"), {
        description: t("maxCharacters", {
          max: MAX_RECIPE_PASTE_CHARS.toLocaleString(),
        }),
        variant: "warning",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      importRecipeFromPasteWithAI(trimmed);
      toast(t("importingWithAI"), {
        description: t("inProgress"),
        variant: "default",
      });
      onOpenChange(false);
      setText("");
      router.push("/");
    } catch (error) {
      showSafeErrorToast({
        title: t("failed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error,
        context: "import-from-paste-modal:import-ai",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [importRecipeFromPasteWithAI, onOpenChange, router, t, tErrors, text]);
  const _handleClose = useCallback(() => {
    onOpenChange(false);
    setText("");
  }, [onOpenChange]);
  return (
    <Modal>
      <Modal.Backdrop className="z-[1099]" isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container className="z-[1100]" size="lg">
          <Modal.Dialog>
            {() => (
              <>
                <Modal.Header className="flex flex-col gap-1">{t("title")}</Modal.Header>
                <Modal.Body>
                  <TextArea
                    label={t("label")}
                    maxRows={18}
                    minRows={8}
                    placeholder={t("placeholder")}
                    value={text}
                    onValueChange={setText}
                  />
                  <p className="text-muted text-xs">
                    {t("maxCharacters", {
                      max: MAX_RECIPE_PASTE_CHARS.toLocaleString(),
                    })}
                  </p>
                </Modal.Body>
                <Modal.Footer>
                  {isAIEnabled && (
                    <Button
                      className="bg-gradient-to-r from-rose-400 via-fuchsia-500 to-indigo-500 text-white hover:brightness-110"
                      isDisabled={text.trim().length === 0}
                      onPress={handleAIImport}
                      isPending={isSubmitting}
                    >
                      {!isSubmitting && <SparklesIcon className="h-4 w-4" />}
                      {tActions("aiImport")}
                    </Button>
                  )}
                  <Button
                    isDisabled={text.trim().length === 0}
                    onPress={handleImport}
                    variant="primary"
                    isPending={isSubmitting}
                  >
                    {!isSubmitting && <ArrowDownTrayIcon className="h-4 w-4" />}
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
