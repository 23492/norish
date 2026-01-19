"use client";

import { useEffect, useState } from "react";
import { Button, Input, DatePicker, Select, SelectItem } from "@heroui/react";
import { Panel, PANEL_HEIGHT_COMPACT } from "@/components/Panel/Panel";
import { useCalendarContext } from "@/app/(app)/calendar/context";
import { Slot } from "@/types";
import { parseDate } from "@internationalized/date";
import { TrashIcon } from "@heroicons/react/16/solid";
import { useTranslations } from "next-intl";

const SLOTS: Slot[] = ["Breakfast", "Lunch", "Dinner", "Snack"];

type EditNotePanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteId: string;
  initialTitle: string;
  date: string;
  slot: Slot;
};

export function EditNotePanel({
  open,
  onOpenChange,
  noteId,
  initialTitle,
  date,
  slot,
}: EditNotePanelProps) {
  const { deletePlanned, moveItem } = useCalendarContext();
  const [title, setTitle] = useState(initialTitle);
  const [selectedDate, setSelectedDate] = useState(parseDate(date));
  const [selectedSlot, setSelectedSlot] = useState<Slot>(slot);

  const t = useTranslations("calendar.editNote");
  const tSlots = useTranslations("common.slots");
  const tActions = useTranslations("common.actions");

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setSelectedDate(parseDate(date));
      setSelectedSlot(slot);
    }
  }, [open, initialTitle, date, slot]);

  const handleSave = () => {
    if (!title.trim()) return;

    const newDateStr = selectedDate.toString();

    if (newDateStr !== date || selectedSlot !== slot) {
      moveItem(noteId, newDateStr, selectedSlot, 0);
    }
    onOpenChange(false);
  };

  const handleDelete = () => {
    deletePlanned(noteId);
    onOpenChange(false);
  };

  return (
    <Panel open={open} onOpenChange={onOpenChange} title={t("title")} height={PANEL_HEIGHT_COMPACT}>
      <div className="flex flex-col gap-4">
        <Input
          label={t("noteLabel")}
          value={title}
          onValueChange={setTitle}
          placeholder={t("notePlaceholder")}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSave();
            }
          }}
        />

        <div className="flex gap-3">
          <DatePicker
            label={t("date")}
            value={selectedDate}
            onChange={(d) => d && setSelectedDate(d)}
            className="flex-1"
            isRequired
          />
          <Select
            label={t("slot")}
            selectedKeys={[selectedSlot]}
            onChange={(e) => setSelectedSlot(e.target.value as Slot)}
            className="flex-1"
          >
            {SLOTS.map((s) => (
              <SelectItem key={s}>{tSlots(s.toLowerCase())}</SelectItem>
            ))}
          </Select>
        </div>

        <div className="mt-2 flex justify-between">
          <Button isIconOnly color="danger" variant="light" onPress={handleDelete}>
            <TrashIcon className="h-4 w-4" />
          </Button>
          <Button color="primary" onPress={handleSave}>
            {tActions("save")}
          </Button>
        </div>
      </div>
    </Panel>
  );
}
