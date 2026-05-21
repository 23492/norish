"use client";

import AmountDisplayToggle from "@/app/(app)/recipes/[id]/components/amount-display-toggle";
import { ReadonlyIngredientsList } from "@/app/(app)/recipes/[id]/components/ingredient-list";
import ServingsControl from "@/app/(app)/recipes/[id]/components/servings-control";
import SystemConvertMenu from "@/app/(app)/recipes/[id]/components/system-convert-menu";
import { ScrollShadow, Separator, Tabs } from "@heroui/react";
import { useTranslations } from "next-intl";

import type { CookingModeDialogProps } from "./types";

type CookingIngredientsViewProps = Pick<
  CookingModeDialogProps,
  "displayIngredients" | "recipeServings" | "recipeSystemUsed" | "onPointerDown" | "onPointerUp"
> & {
  showTitle: boolean;
};

export function CookingIngredientsView({
  displayIngredients,
  recipeServings,
  recipeSystemUsed,
  showTitle,
  onPointerDown,
  onPointerUp,
}: CookingIngredientsViewProps) {
  const tCookMode = useTranslations("recipes.cookMode");

  return (
    <Tabs.Panel
      className="min-h-0 flex-1 overflow-hidden"
      id="ingredients"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-col items-stretch gap-4 px-4 pt-4 md:flex-row md:items-center md:justify-between md:px-6 md:pt-5">
          {showTitle ? (
            <div>
              <h3 className="text-lg font-semibold">{tCookMode("ingredients")}</h3>
              {recipeServings ? (
                <p className="text-muted text-sm">
                  {tCookMode("serving", { count: recipeServings })}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <AmountDisplayToggle />
            {recipeServings ? <ServingsControl /> : null}
            {recipeSystemUsed ? <SystemConvertMenu /> : null}
          </div>
        </div>
        <Separator className="mt-4" />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollShadow className="h-full px-4 py-4 md:px-6" size={64}>
            <ReadonlyIngredientsList
              interactive
              ingredients={displayIngredients}
              systemUsed={recipeSystemUsed}
            />
          </ScrollShadow>
        </div>
      </div>
    </Tabs.Panel>
  );
}
