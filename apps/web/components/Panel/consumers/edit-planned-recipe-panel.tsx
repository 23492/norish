"use client";

import type { Key } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useCalendarContext } from "@/app/(app)/calendar/context";
import { PlannedItemThumbnail } from "@/components/calendar/planned-item-thumbnail";
import { Panel } from "@/components/Panel/Panel";
import { ArrowTopRightOnSquareIcon, TrashIcon } from "@heroicons/react/16/solid";
import { Button, DatePicker, Label, ListBox, Select } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import { useTranslations } from "next-intl";

import { Slot } from "@norish/shared/contracts";

const SLOTS: Slot[] = ["Breakfast", "Lunch", "Dinner", "Snack"];
type EditPlannedRecipePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  recipeName: string;
  recipeImage: string | null;
  recipeId: string;
  date: string;
  slot: Slot;
};
export function EditPlannedRecipePanel({
  open,
  onOpenChange,
  itemId,
  recipeName,
  recipeImage,
  recipeId,
  date,
  slot,
}: EditPlannedRecipePanelProps) {
  const { deletePlanned, moveItem, planMeal } = useCalendarContext();
  const [selectedDate, setSelectedDate] = useState(parseDate(date));
  const [selectedSlot, setSelectedSlot] = useState<Slot>(slot);
  const t = useTranslations("calendar.editPlannedRecipe");
  const tSlots = useTranslations("common.slots");
  const tActions = useTranslations("common.actions");
  const tTimeline = useTranslations("calendar.timeline");
  useEffect(() => {
    if (open) {
      setSelectedDate(parseDate(date));
      setSelectedSlot(slot);
    }
  }, [open, date, slot]);
  const handleSave = () => {
    const newDateStr = selectedDate.toString();
    const locationChanged = newDateStr !== date || selectedSlot !== slot;
    if (locationChanged) {
      moveItem(itemId, newDateStr, selectedSlot, 0);
    }
    onOpenChange(false);
  };
  const handleDelete = () => {
    deletePlanned(itemId);
    onOpenChange(false);
  };
  const handleDuplicate = () => {
    planMeal(selectedDate.toString(), selectedSlot, recipeId);
  };
  const handleSlotChange = (value: Key | null) => {
    if (value) {
      setSelectedSlot(value.toString() as Slot);
    }
  };
  return (
    <Panel open={open} title={t("title")} onOpenChange={onOpenChange}>
      <Panel.Body>
        {/* Recipe preview */}
        <Link
          className="flex items-center gap-3 rounded-lg"
          href={`/recipes/${recipeId}`}
          onClick={() => onOpenChange(false)}
        >
          <PlannedItemThumbnail alt={recipeName} image={recipeImage} itemType="recipe" size="md" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-foreground truncate text-base font-medium">{recipeName}</span>
            <span className="text-accent flex items-center gap-1 text-sm">
              {tTimeline("goToRecipe")}
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </span>
          </div>
        </Link>

        <div className="flex gap-3">
          <DatePicker
            isRequired
            className="flex-1"
            label={t("date")}
            value={selectedDate}
            onChange={(d) => d && setSelectedDate(d)}
          />
          <Select
            className="flex-1"
            selectedKey={selectedSlot}
            variant="secondary"
            onSelectionChange={handleSlotChange}
          >
            <Label>{t("slot")}</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {SLOTS.map((s) => (
                  <ListBox.Item key={s} id={s} textValue={tSlots(s.toLowerCase())}>
                    {tSlots(s.toLowerCase())}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>
      </Panel.Body>
      <Panel.Footer>
        <div className="flex justify-end gap-2">
          <Button isIconOnly onPress={handleDelete} variant="danger-soft">
            <TrashIcon className="h-4 w-4" />
          </Button>
          <Button className="min-w-24" onPress={handleDuplicate} variant="tertiary">
            {tActions("duplicate")}
          </Button>
          <Button className="min-w-24" onPress={handleSave} variant="primary">
            {tActions("save")}
          </Button>
        </div>
      </Panel.Footer>
    </Panel>
  );
}
