"use client";

import { Card, CardBody, CardHeader, Divider } from "@heroui/react";
import { useFormatter } from "next-intl";
import { Fragment } from "react";

import { CalendarSlot } from "./calendar-slot";

import { Slot } from "@/types";

export type DayColumnProps = {
  date: Date;
  dateKey: string;
  isToday: boolean;
  onAddClick: (slot: Slot) => void;
  onEditNote: (id: string, title: string, date: string, slot: Slot) => void;
};

const SLOTS: Slot[] = ["Breakfast", "Lunch", "Dinner", "Snack"];

export function DayColumn({ date, dateKey, isToday, onAddClick, onEditNote }: DayColumnProps) {
  const format = useFormatter();

  return (
    <Card
      className={`shadow-medium h-[550px] w-full border-none ${
        isToday ? "ring-primary ring-2" : ""
      }`}
      radius="lg"
    >
      <CardHeader className="flex flex-col items-start gap-1 px-4 pt-4 pb-1">
        <div className="flex w-full items-center justify-between">
          <div className="flex flex-col">
            <h2
              className={`text-2xl font-bold tracking-tight ${
                isToday ? "text-primary" : "text-foreground"
              }`}
            >
              {format.dateTime(date, { weekday: "long" })}
            </h2>
            <span className="text-default-500 text-sm font-medium">
              {format.dateTime(date, { month: "long", day: "numeric" })}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardBody className="gap-0 px-4 py-3">
        {SLOTS.map((slot, i) => (
          <Fragment key={slot}>
            <CalendarSlot
              date={dateKey}
              slot={slot}
              onAddClick={() => onAddClick(slot)}
              onEditNote={onEditNote}
            />
            {i < SLOTS.length - 1 && <Divider className="my-4" />}
          </Fragment>
        ))}
      </CardBody>
    </Card>
  );
}
