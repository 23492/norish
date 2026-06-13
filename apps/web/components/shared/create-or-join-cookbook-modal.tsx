"use client";

import { FormEvent, useState } from "react";
import { HomeIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  InputOtp,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  REGEXP_ONLY_DIGITS,
} from "@heroui/react";
import { useTranslations } from "next-intl";

import { useHouseholdContext } from "@/context/household-context";

interface CreateOrJoinCookbookFormsProps {
  /** Called after a create or join is dispatched (e.g. to close the modal). */
  onCompleted?: () => void;
}

/**
 * The Create (name) + Join (6-digit code) cookbook forms.
 *
 * Sources createHousehold/joinHousehold from the GLOBAL household context so the
 * same forms work from the navbar switcher as well as the household settings
 * page. Shared by CreateOrJoinCookbookModal and the settings NoHouseholdView.
 */
export function CreateOrJoinCookbookForms({ onCompleted }: CreateOrJoinCookbookFormsProps) {
  const t = useTranslations("settings.household");
  const { createHousehold, joinHousehold } = useHouseholdContext();
  const [householdName, setHouseholdName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const handleCreateHousehold = async (e: FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    createHousehold(householdName);
    setHouseholdName("");
    setIsCreating(false);
    onCompleted?.();
  };

  const handleJoinHousehold = async (e: FormEvent) => {
    e.preventDefault();
    setIsJoining(true);
    joinHousehold(joinCode);
    setJoinCode("");
    setIsJoining(false);
    onCompleted?.();
  };

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {/* Create Cookbook */}
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <HomeIcon className="h-5 w-5" />
            {t("create.title")}
          </h2>
        </CardHeader>
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={handleCreateHousehold}>
            <p className="text-default-600 text-base">{t("create.description")}</p>
            <Input
              isRequired
              label={t("create.nameLabel")}
              placeholder={t("create.namePlaceholder")}
              value={householdName}
              onValueChange={setHouseholdName}
            />
            <div className="flex justify-end">
              <Button color="primary" isLoading={isCreating} type="submit">
                {t("create.submitButton")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* Join Cookbook */}
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UserGroupIcon className="h-5 w-5" />
            {t("join.title")}
          </h2>
        </CardHeader>
        <CardBody>
          <form className="flex flex-col gap-4" onSubmit={handleJoinHousehold}>
            <p className="text-default-600 text-base">{t("join.description")}</p>
            <InputOtp
              isRequired
              allowedKeys={REGEXP_ONLY_DIGITS}
              classNames={{ segmentWrapper: "justify-start" }}
              label={t("join.codeLabel")}
              length={6}
              placeholder={t("join.codePlaceholder")}
              value={joinCode}
              onValueChange={setJoinCode}
            />
            <div className="flex justify-end">
              <Button color="primary" isLoading={isJoining} type="submit">
                {t("join.submitButton")}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

interface CreateOrJoinCookbookModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Modal wrapper around the Create/Join cookbook forms, opened from the navbar
 * cookbook switcher so a user with an existing cookbook can create or join
 * another at any time.
 */
export default function CreateOrJoinCookbookModal({
  isOpen,
  onOpenChange,
}: CreateOrJoinCookbookModalProps) {
  const t = useTranslations("settings.household");

  return (
    <Modal
      classNames={{ wrapper: "z-[1100]", backdrop: "z-[1099]" }}
      isOpen={isOpen}
      size="3xl"
      onOpenChange={onOpenChange}
    >
      <ModalContent>
        {(onClose: () => void) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              {t("createOrJoin.title")}
            </ModalHeader>
            <ModalBody className="pb-6">
              <CreateOrJoinCookbookForms onCompleted={onClose} />
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
