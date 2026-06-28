"use client";

import { useState } from "react";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/16/solid";
import { CheckIcon, HomeIcon, PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { Button, Card, Chip, Input, Modal, Separator, toast } from "@heroui/react";
import { useTranslations } from "next-intl";

import { useHouseholdSettingsContext } from "../context";

import { showSafeErrorToast } from "@/lib/ui/safe-error-toast";

export default function HouseholdInfoCard() {
  const t = useTranslations("settings.household.info");
  const tRename = useTranslations("settings.household.rename");
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const { household, currentUserId, leaveHousehold, rename } = useHouseholdSettingsContext();
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  if (!household) return null;

  // Check if current user is admin
  const currentUserData = currentUserId
    ? household.users.find((u) => u.id === currentUserId)
    : null;
  const isAdmin = currentUserData?.isAdmin === true;
  const otherMembers = household.users.filter((u) => u.id !== currentUserId);

  const handleLeaveHousehold = async () => {
    await leaveHousehold(household.id);
    setShowLeaveModal(false);
  };

  const startEditingName = () => {
    setNameDraft(household.name);
    setIsEditingName(true);
  };

  const cancelEditingName = () => {
    setIsEditingName(false);
    setNameDraft("");
  };

  const handleSaveName = () => {
    const trimmed = nameDraft.trim();

    if (!trimmed || trimmed === household.name) {
      cancelEditingName();

      return;
    }

    try {
      // Pass the current household version for optimistic concurrency.
      rename(household.id, trimmed, household.version);
      toast(tRename("success"), { variant: "success" });
    } catch (error) {
      showSafeErrorToast({
        title: tRename("failed"),
        description: tErrors("technicalDetails"),
        color: "danger",
        error,
        context: "household-info:rename",
      });
    } finally {
      setIsEditingName(false);
      setNameDraft("");
    }
  };

  return (
    <>
      <Card>
        <Card.Header className="flex-row items-center justify-between gap-2">
          {isAdmin && isEditingName ? (
            <div className="flex w-full items-center gap-2">
              <Input
                aria-label={tRename("label")}
                placeholder={tRename("placeholder")}
                value={nameDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") cancelEditingName();
                }}
                onValueChange={setNameDraft}
              />
              <Button
                isIconOnly
                aria-label={tActions("save")}
                size="sm"
                variant="primary"
                onPress={handleSaveName}
              >
                <CheckIcon className="h-4 w-4" />
              </Button>
              <Button
                isIconOnly
                aria-label={tActions("cancel")}
                size="sm"
                variant="tertiary"
                onPress={cancelEditingName}
              >
                <XMarkIcon className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <HomeIcon className="h-5 w-5" />
                {household.name}
              </h2>
              {isAdmin && (
                <Button
                  isIconOnly
                  aria-label={tRename("button")}
                  size="sm"
                  variant="tertiary"
                  onPress={startEditingName}
                >
                  <PencilSquareIcon className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </Card.Header>
        <Card.Content className="gap-4">
          <div className="flex items-center justify-between">
            <span className="text-muted text-base">{t("yourRole")}</span>
            <Chip color={isAdmin ? "accent" : "default"} size="sm" variant="soft">
              {isAdmin ? t("admin") : t("member")}
            </Chip>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted text-base">{t("members")}</span>
            <span className="text-base font-medium">{household.users.length}</span>
          </div>
          <Separator />
          <div className="flex justify-end">
            <Button onPress={() => setShowLeaveModal(true)} variant="danger-soft">
              {<ArrowLeftStartOnRectangleIcon className="h-4 w-4" />}
              {t("leaveButton")}
            </Button>
          </div>
        </Card.Content>
      </Card>

      {/* Leave Household Modal */}
      <Modal>
        <Modal.Backdrop
          className="z-[1099]"
          isOpen={showLeaveModal}
          onOpenChange={setShowLeaveModal}
        >
          <Modal.Container className="z-[1100]">
            <Modal.Dialog>
              {({ close: onClose }) => (
                <>
                  <Modal.Header>{t("leaveModal.title")}</Modal.Header>
                  <Modal.Body>
                    <p>
                      {t("leaveModal.confirmMessage", {
                        name: household.name,
                      })}
                    </p>
                    {isAdmin && otherMembers.length > 0 && (
                      <p className="text-warning mt-2">{t("leaveModal.adminWarning")}</p>
                    )}
                  </Modal.Body>
                  <Modal.Footer>
                    <Button onPress={onClose} variant="tertiary">
                      {tActions("cancel")}
                    </Button>
                    <Button onPress={handleLeaveHousehold} variant="danger">
                      {t("leaveModal.confirmButton")}
                    </Button>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
