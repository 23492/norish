"use client";

import { useRouter } from "next/navigation";
import { MealIcon } from "@/lib/meal-icon";
import { PlusIcon } from "@heroicons/react/16/solid";
import { Button, Card, Chip } from "@heroui/react";
import { useTranslations } from "next-intl";

import type { TodayMealSlotCardProps } from "./todays-meals-types";
import { buildPlannedItemSubtitle, getPlannedItemTitle } from "./todays-meals-helpers";
import TodaysMealsSlotChip from "./todays-meals-slot-chip";

export default function TodayMealSlotCard({
  slot,
  slotLabel,
  items,
  onPlan,
}: TodayMealSlotCardProps) {
  const router = useRouter();
  const tCalendar = useTranslations("calendar.timeline");
  const tCalendarPanel = useTranslations("calendar.panel");
  const primaryItem = items[0];
  const remainingCount = Math.max(items.length - 1, 0);
  const isPlanned = Boolean(primaryItem);
  const imageSrc = primaryItem?.itemType === "recipe" ? primaryItem.recipeImage : null;
  const title = getPlannedItemTitle(primaryItem, tCalendar("untitled"));
  const subtitle = buildPlannedItemSubtitle(primaryItem, {
    note: tCalendar("note"),
    serving: tCalendar("serving"),
    servings: tCalendar("servings"),
  });

  const handleOpen = () => {
    if (primaryItem?.itemType === "recipe" && primaryItem.recipeId) {
      router.push(`/recipes/${primaryItem.recipeId}`);
      return;
    }

    if (!primaryItem) {
      onPlan(slot);
      return;
    }

    router.push("/calendar");
  };

  return (
    <Card
      className="h-[190px] w-[176px] shrink-0 overflow-hidden rounded-2xl p-0 sm:w-[190px]"
      variant={isPlanned ? "default" : "secondary"}
    >
      <Button
        aria-label={isPlanned ? title : `${tCalendarPanel("addRecipe")} ${slotLabel}`}
        className="group flex h-full w-full cursor-[var(--cursor-interactive)] flex-col overflow-hidden rounded-2xl border-0 bg-transparent p-0 text-left focus-visible:outline-none"
        variant="ghost"
        onPress={handleOpen}
      >
        {isPlanned ? (
          <>
            <div className="bg-surface-secondary relative h-[96px] w-full overflow-hidden">
              {imageSrc ? (
                <img
                  alt={title}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                  src={imageSrc}
                />
              ) : (
                <div className="text-muted flex h-full w-full items-center justify-center">
                  <MealIcon className="h-8 w-8" slot={slot} />
                </div>
              )}

              <TodaysMealsSlotChip
                className="bg-overlay/85 text-foreground absolute top-2 left-2 max-w-[calc(100%-4rem)] backdrop-blur"
                slot={slot}
                slotLabel={slotLabel}
              />

              {remainingCount > 0 ? (
                <Chip
                  className="bg-overlay/85 text-foreground absolute top-2 right-2 backdrop-blur"
                  size="sm"
                  variant="secondary"
                >
                  +{remainingCount}
                </Chip>
              ) : null}
            </div>

            <Card.Content className="flex min-h-0 flex-1 flex-col justify-center gap-1 rounded-b-2xl px-3 py-2.5">
              <Card.Title
                className="text-foreground line-clamp-2 min-w-0 text-sm leading-5 break-words"
                title={title}
              >
                {title}
              </Card.Title>
              {subtitle ? (
                <Card.Description className="line-clamp-1 min-w-0 text-xs">
                  {subtitle}
                </Card.Description>
              ) : null}
            </Card.Content>
          </>
        ) : (
          <Card.Content className="flex h-full min-h-0 flex-col items-start gap-3 rounded-b-2xl p-3">
            <TodaysMealsSlotChip className="max-w-full" slot={slot} slotLabel={slotLabel} />
            <div className="text-muted flex flex-1 flex-col items-center justify-center gap-2 self-stretch text-center">
              <PlusIcon className="h-6 w-6" />
              <span className="text-foreground text-sm font-medium">
                {tCalendarPanel("addRecipe")}
              </span>
            </div>
          </Card.Content>
        )}
      </Button>
    </Card>
  );
}
