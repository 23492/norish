"use client";

import { useMemo, useState } from "react";
import { BookOpenIcon, ChevronUpDownIcon } from "@heroicons/react/16/solid";
import { Chip } from "@heroui/react";
import { useTranslations } from "next-intl";

import MoveRecipeModal, { type MoveDestination } from "./move-recipe-modal";

import { usePermissionsContext } from "@/context/permissions-context";
import { useHouseholdContext } from "@/context/household-context";

type CookbookChipRecipe = {
  id: string;
  householdId: string | null;
  userId: string | null;
  version: number;
};

/**
 * Shows which cookbook a recipe lives in (CKBK-MOVE-01, scope item 1) — the name
 * of its household, or "Personal" for a `household_id IS NULL` recipe. When the
 * viewer can edit the recipe and there is at least one other cookbook they may
 * write to, the chip becomes a button that opens the move picker (scope item 2).
 *
 * Destinations offered = the viewer's cookbooks minus the current one, plus
 * "Personal" ONLY for the owner (moving into Personal requires ownership; the
 * server enforces this too). The chip stays a static label when the viewer
 * cannot move the recipe.
 */
export default function CookbookChip({ recipe }: { recipe: CookbookChipRecipe }) {
  const tCookbook = useTranslations("navbar.cookbook");
  const tMove = useTranslations("recipes.move");
  const { households, currentUserId } = useHouseholdContext();
  const { canEditRecipe } = usePermissionsContext();
  const [isMoveOpen, setIsMoveOpen] = useState(false);

  const cookbookName = recipe.householdId
    ? (households.find((cookbook) => cookbook.id === recipe.householdId)?.name ??
      tCookbook("label"))
    : tCookbook("personal");

  const canEdit = recipe.userId ? canEditRecipe(recipe.userId) : true;
  const isOwner = recipe.userId != null && recipe.userId === currentUserId;

  const destinations = useMemo<MoveDestination[]>(() => {
    const items: MoveDestination[] = [];

    // "Personal" is the owner's own space — only offer it to the owner, and only
    // when the recipe is not already personal.
    if (isOwner && recipe.householdId !== null) {
      items.push({ id: null, name: tCookbook("personal") });
    }

    for (const cookbook of households) {
      if (cookbook.id !== recipe.householdId) {
        items.push({ id: cookbook.id, name: cookbook.name });
      }
    }

    return items;
  }, [households, isOwner, recipe.householdId, tCookbook]);

  const canMove = canEdit && destinations.length > 0;

  const content = (
    <span className="flex items-center gap-1.5">
      <BookOpenIcon className="size-3.5 shrink-0" />
      <span className="truncate">{cookbookName}</span>
    </span>
  );

  if (!canMove) {
    return (
      <Chip size="sm" variant="soft">
        {content}
      </Chip>
    );
  }

  return (
    <>
      <button
        aria-label={tMove("openLabel", { cookbook: cookbookName })}
        className="bg-surface-secondary text-muted hover:text-foreground inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors active:scale-95"
        type="button"
        onClick={() => setIsMoveOpen(true)}
      >
        {content}
        <ChevronUpDownIcon className="size-3.5 shrink-0 opacity-70" />
      </button>

      <MoveRecipeModal
        currentCookbookName={cookbookName}
        destinations={destinations}
        isOpen={isMoveOpen}
        recipe={{ id: recipe.id, version: recipe.version }}
        onClose={() => setIsMoveOpen(false)}
      />
    </>
  );
}
