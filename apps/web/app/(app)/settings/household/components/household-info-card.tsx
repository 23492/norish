"use client";

import { useState } from "react";
import { ArrowLeftStartOnRectangleIcon } from "@heroicons/react/16/solid";
import { CheckIcon, HomeIcon, PencilSquareIcon, XMarkIcon } from "@heroicons/react/24/outline";
import {
  addToast,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/react";
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
      addToast({
        title: tRename("success"),
        color: "success",
        shouldShowTimeoutProgress: true,
        radius: "full",
      });
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
        <CardHeader className="flex items-center justify-between gap-2">
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
                color="primary"
                size="sm"
                variant="flat"
                onPress={handleSaveName}
              >
                <CheckIcon className="h-4 w-4" />
              </Button>
              <Button
                isIconOnly
                aria-label={tActions("cancel")}
                size="sm"
                variant="flat"
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
                  variant="light"
                  onPress={startEditingName}
                >
                  <PencilSquareIcon className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
        </CardHeader>
        <CardBody className="gap-4">
          <div className="flex items-center justify-between">
            <span className="text-default-600 text-base">{t("yourRole")}</span>
            <Chip color={isAdmin ? "primary" : "default"} size="sm" variant="flat">
              {isAdmin ? t("admin") : t("member")}
            </Chip>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-default-600 text-base">{t("members")}</span>
            <span className="text-base font-medium">{household.users.length}</span>
          </div>
          <Divider />
          <div className="flex justify-end">
            <Button
              color="danger"
              startContent={<ArrowLeftStartOnRectangleIcon className="h-4 w-4" />}
              variant="flat"
              onPress={() => setShowLeaveModal(true)}
            >
              {t("leaveButton")}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Leave Household Modal */}
      <Modal
        classNames={{ wrapper: "z-[1100]", backdrop: "z-[1099]" }}
        isOpen={showLeaveModal}
        onOpenChange={setShowLeaveModal}
      >
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>{t("leaveModal.title")}</ModalHeader>
              <ModalBody>
                <p>{t("leaveModal.confirmMessage", { name: household.name })}</p>
                {isAdmin && otherMembers.length > 0 && (
                  <p className="text-warning mt-2">{t("leaveModal.adminWarning")}</p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  {tActions("cancel")}
                </Button>
                <Button color="danger" onPress={handleLeaveHousehold}>
                  {t("leaveModal.confirmButton")}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
