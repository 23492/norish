"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import ImportFromImageModal from "@/components/shared/import-from-image-modal";
import ImportFromPasteModal from "@/components/shared/import-from-paste-modal";
import ImportRecipeModal from "@/components/shared/import-recipe-modal";
import { usePermissionsContext } from "@/context/permissions-context";
import {
  ArrowDownTrayIcon,
  ClipboardDocumentIcon,
  PhotoIcon,
  PlusIcon,
} from "@heroicons/react/16/solid";
import { Button, Dropdown, Label } from "@heroui/react";
import { useTranslations } from "next-intl";

export default function CreateRecipeButton() {
  const router = useRouter();
  const { isAIEnabled } = usePermissionsContext();
  const [showImportModal, setShowImportModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const t = useTranslations("recipes.dashboard");
  const tCommon = useTranslations("common.actions");
  const renderMenuItems = () => (
    <>
      <Dropdown.Item
        id="import"
        key="import"
        textValue={t("importFromUrl")}
        onPress={() => setShowImportModal(true)}
      >
        {<ArrowDownTrayIcon className="h-4 w-4" />}
        <Label>{t("importFromUrl")}</Label>
      </Dropdown.Item>
      <Dropdown.Item
        id="paste"
        key="paste"
        textValue={t("importFromPaste")}
        onPress={() => setShowPasteModal(true)}
      >
        {<ClipboardDocumentIcon className="h-4 w-4" />}
        <Label>{t("importFromPaste")}</Label>
      </Dropdown.Item>
      {isAIEnabled ? (
        <Dropdown.Item
          id="image"
          key="image"
          textValue={t("importFromImage")}
          onPress={() => setShowImageModal(true)}
        >
          {<PhotoIcon className="h-4 w-4" />}
          <Label>{t("importFromImage")}</Label>
        </Dropdown.Item>
      ) : null}
      <Dropdown.Item
        id="create"
        key="create"
        textValue={tCommon("create")}
        onPress={() => router.push("/recipes/new")}
      >
        {<PlusIcon className="h-4 w-4" />}
        <Label>{tCommon("create")}</Label>
      </Dropdown.Item>
    </>
  );
  return (
    <>
      <Dropdown>
        <Button
          aria-label={t("addRecipe")}
          className="min-w-10 rounded-full font-medium md:min-w-20"
          size="md"
          variant="primary"
        >
          <PlusIcon className="h-5 w-5" />
          <span className="hidden md:inline">{t("addRecipe")}</span>
        </Button>
        <Dropdown.Popover className="bg-overlay" placement="bottom end">
          <Dropdown.Menu aria-label="Add recipe options">{renderMenuItems()}</Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <ImportRecipeModal isOpen={showImportModal} onOpenChange={setShowImportModal} />
      <ImportFromPasteModal isOpen={showPasteModal} onOpenChange={setShowPasteModal} />
      {isAIEnabled && (
        <ImportFromImageModal isOpen={showImageModal} onOpenChange={setShowImageModal} />
      )}
    </>
  );
}
