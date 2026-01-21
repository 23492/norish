"use client";

import { memo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Image,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  Button,
} from "@heroui/react";
import { ExclamationTriangleIcon, EllipsisVerticalIcon } from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";

import { CalendarItemViewDto } from "@/types";
import { MiniGroceries } from "@/components/Panel/consumers";

type CalendarItemProps = {
  item: CalendarItemViewDto;
  onDelete: () => void;
  onNavigate?: () => void;
  onEdit?: () => void;
};

export const CalendarItem = memo(function CalendarItem({
  item,
  onDelete,
  onNavigate,
  onEdit,
}: CalendarItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { item },
  });

  const [isGroceriesOpen, setIsGroceriesOpen] = useState(false);

  const isRecipe = item.itemType === "recipe";

  const handleDoubleClick = () => {
    if (isRecipe) {
      onNavigate?.();
    } else {
      onEdit?.();
    }
  };

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const t = useTranslations("calendar");
  const tActions = useTranslations("common.actions");

  const hasAllergies = isRecipe && item.allergyWarnings && item.allergyWarnings.length > 0;
  const image = isRecipe ? item.recipeImage : null;

  const subtitle = isRecipe
    ? [
        item.servings ? `${item.servings} servings` : null,
        item.calories ? `${item.calories} kcal` : null,
      ]
        .filter(Boolean)
        .join(" • ") || "Recipe"
    : "Note";

  const handleAddToGroceries = () => {
    setIsGroceriesOpen(true);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="group border-default-100 active:bg-default-50 focus-visible:ring-primary relative flex w-full touch-none items-center justify-between border-b py-3 transition-colors outline-none last:border-b-0 focus-visible:ring-2"
        role="button"
        tabIndex={0}
        onDoubleClick={handleDoubleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            handleDoubleClick();
          }
        }}
      >
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
              {hasAllergies && (
                <ExclamationTriangleIcon className="text-warning h-4 w-4 shrink-0" />
              )}
            </div>
            <span className="text-default-500 truncate text-left text-sm">{subtitle}</span>
          </div>
        </div>

        <div
          className="flex items-center"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Dropdown>
            <DropdownTrigger>
              <Button
                isIconOnly
                className="text-default-400 data-[hover=true]:text-primary h-8 w-8 min-w-8"
                size="sm"
                variant="light"
              >
                <EllipsisVerticalIcon className="h-5 w-5" />
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label={t("timeline.itemActions")}>
              {isRecipe ? (
                <DropdownItem key="goto" onPress={onNavigate}>
                  {t("timeline.goToRecipe")}
                </DropdownItem>
              ) : null}

              {isRecipe ? (
                <DropdownItem key="groceries" onPress={handleAddToGroceries}>
                  {t("timeline.addToGroceries")}
                </DropdownItem>
              ) : (
                <DropdownItem key="edit" onPress={onEdit}>
                  {tActions("edit")}
                </DropdownItem>
              )}

              <DropdownItem key="delete" className="text-danger" color="danger" onPress={onDelete}>
                {t("timeline.deleteItem")}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        </div>
      </div>

      {item.itemType === "recipe" && isGroceriesOpen && (
        <MiniGroceries
          initialServings={item.servings ?? 1}
          open={isGroceriesOpen}
          originalServings={item.servings ?? 1}
          recipeId={item.recipeId ?? ""}
          onOpenChange={setIsGroceriesOpen}
        />
      )}
    </>
  );
});
