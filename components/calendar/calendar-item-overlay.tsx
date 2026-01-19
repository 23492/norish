"use client";

import { Card, Image } from "@heroui/react";
import { ExclamationTriangleIcon } from "@heroicons/react/16/solid";

import { CalendarItemViewDto } from "@/types";

export function CalendarItemOverlay({ item }: { item: CalendarItemViewDto }) {
  const isRecipe = item.itemType === "recipe";
  const hasAllergies = isRecipe && item.allergyWarnings && item.allergyWarnings.length > 0;
  const image = isRecipe ? item.recipeImage : null;
  const subtitle = isRecipe
    ? [
        item.servings ? `${item.servings} servings` : null,
        item.calories ? `${item.calories} kcal` : null,
      ]
        .filter(Boolean)
        .join(" * ") || "Recipe"
    : "Note";

  return (
    <Card className="bg-content1 w-[calc(100vw-56px)] cursor-grabbing flex-row items-center justify-between p-3 opacity-90 shadow-xl sm:w-[350px]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {image && (
          <Image
            alt={item.itemType === "recipe" ? item.recipeName || "Recipe" : "Recipe"}
            classNames={{
              wrapper: "shrink-0",
              img: "h-12 w-12 rounded-lg object-cover",
            }}
            src={image}
          />
        )}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2">
            <span className="text-default-900 truncate text-base font-medium">
              {isRecipe ? item.recipeName : item.title}
            </span>
            {hasAllergies && <ExclamationTriangleIcon className="text-warning h-4 w-4 shrink-0" />}
          </div>
          <span className="text-default-500 truncate text-left text-sm">{subtitle}</span>
        </div>
      </div>
    </Card>
  );
}
