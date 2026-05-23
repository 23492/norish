"use client";

import { useRouter } from "next/navigation";
import { PlusIcon } from "@heroicons/react/16/solid";
import { PhotoIcon } from "@heroicons/react/24/outline";
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
      className="!h-[184px] !max-h-[184px] !min-h-[184px] !w-[144px] !max-w-[144px] !min-w-[144px] shrink-0 overflow-hidden rounded-2xl p-0 sm:!w-[152px] sm:!max-w-[152px] sm:!min-w-[152px]"
      variant={isPlanned ? "default" : "secondary"}
    >
      <Button
        aria-label={isPlanned ? title : `${tCalendarPanel("addRecipe")} ${slotLabel}`}
        className="group grid !h-[184px] !max-h-[184px] !min-h-[184px] !w-full !max-w-full !min-w-0 cursor-[var(--cursor-interactive)] grid-rows-[120px_64px] overflow-hidden rounded-2xl border-0 bg-transparent p-0 text-left focus-visible:outline-none"
        variant="ghost"
        onPress={handleOpen}
      >
        {isPlanned ? (
          <>
            <div className="bg-surface-secondary relative !h-[120px] !max-h-[120px] !min-h-[120px] w-full overflow-hidden">
              {imageSrc ? (
                <img
                  alt={title}
                  className="block !h-full !max-h-full !min-h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                  src={imageSrc}
                />
              ) : (
                <div className="text-muted flex h-full w-full items-center justify-center">
                  <PhotoIcon className="h-8 w-8" />
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

            <Card.Content className="flex !h-[64px] !max-h-[64px] !min-h-[64px] w-full flex-col justify-center gap-0.5 overflow-hidden rounded-b-2xl px-2.5 py-1.5">
              <Card.Title
                className="text-foreground w-full min-w-0 truncate text-left text-xs leading-[15px]"
                title={title}
              >
                {title}
              </Card.Title>
              {subtitle ? (
                <Card.Description className="w-full min-w-0 truncate text-left text-[10px] leading-3">
                  {subtitle}
                </Card.Description>
              ) : null}
            </Card.Content>
          </>
        ) : (
          <Card.Content className="relative row-span-2 flex !h-[184px] !max-h-[184px] !min-h-[184px] flex-col rounded-b-2xl p-3">
            <TodaysMealsSlotChip
              className="bg-overlay/85 text-foreground absolute top-2 left-2 max-w-[calc(100%-4rem)] backdrop-blur"
              slot={slot}
              slotLabel={slotLabel}
            />
            <div className="text-muted flex h-full flex-col items-center justify-center gap-2 self-stretch pt-6 text-center">
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
