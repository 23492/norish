"use client";

import { BookOpenIcon } from "@heroicons/react/16/solid";
import { Button, Modal, toast } from "@heroui/react";
import { useTranslations } from "next-intl";

import { useRecipesContext } from "@/context/recipes-context";

export type MoveDestination = {
  /** null = the "Personal" cookbook. */
  id: string | null;
  name: string;
};

type MoveRecipeModalProps = {
  recipe: { id: string; version: number };
  destinations: MoveDestination[];
  currentCookbookName: string;
  isOpen: boolean;
  onClose: () => void;
};

/**
 * Move-a-recipe-to-another-cookbook picker (CKBK-MOVE-01). Lists only the
 * destinations the caller passed (cookbooks the viewer may write to, minus the
 * current one); the server re-enforces edit-on-source + membership/ownership of
 * the destination, so an unauthorised move is rejected regardless of the UI.
 */
export default function MoveRecipeModal({
  recipe,
  destinations,
  currentCookbookName,
  isOpen,
  onClose,
}: MoveRecipeModalProps) {
  const t = useTranslations("recipes.move");
  const tActions = useTranslations("common.actions");
  const { moveRecipe } = useRecipesContext();

  const handleSelect = (destination: MoveDestination) => {
    moveRecipe(recipe.id, destination.id, recipe.version);
    toast(t("movedToast", { cookbook: destination.name }), { variant: "accent" });
    onClose();
  };

  return (
    <Modal>
      <Modal.Backdrop className="z-[1099]" isOpen={isOpen} onOpenChange={onClose}>
        <Modal.Container className="z-[1100]" size="sm">
          <Modal.Dialog>
            {({ close }) => (
              <>
                <Modal.CloseTrigger />
                <Modal.Header className="flex flex-col gap-1">{t("title")}</Modal.Header>
                <Modal.Body>
                  <p className="text-muted text-sm">
                    {t("description", { cookbook: currentCookbookName })}
                  </p>
                  <div className="flex flex-col gap-2 pt-2">
                    {destinations.map((destination) => (
                      <Button
                        key={destination.id ?? "personal"}
                        className="w-full justify-start"
                        variant="tertiary"
                        onPress={() => handleSelect(destination)}
                      >
                        <BookOpenIcon className="text-muted size-4 shrink-0" />
                        <span className="truncate">{destination.name}</span>
                      </Button>
                    ))}
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="tertiary" onPress={close}>
                    {tActions("cancel")}
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
