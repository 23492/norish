"use client";

import type { DropZoneProps as AriaDropZoneProps } from "react-aria-components";
import type { ReactNode } from "react";
import { Button } from "@heroui/react";
import { DropZone as AriaDropZone, FileTrigger } from "react-aria-components";

/**
 * Local styled DropZone compound built on `react-aria-components` (free, already
 * installed transitively via HeroUI v3) — replaces the paid `@heroui-pro/react`
 * DropZone. `DropZone.Area` is the RAC DropZone (drag target); `DropZone.Trigger`
 * wraps a FileTrigger + free Button (file picker), folding in the old `.Input`.
 * The drop callbacks (`onDrop`/`getDropOperation`) keep the RAC signatures the
 * pro package re-exported, so consumer logic is unchanged.
 */

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

interface DropZoneRootProps {
  children: ReactNode;
  className?: string;
}

function DropZoneRoot({ children, className }: DropZoneRootProps) {
  return <div className={className}>{children}</div>;
}

export interface DropZoneAreaProps
  extends Pick<AriaDropZoneProps, "getDropOperation" | "onDrop"> {
  children: ReactNode;
  className?: string;
}

function DropZoneArea({ children, className, getDropOperation, onDrop }: DropZoneAreaProps) {
  return (
    <AriaDropZone
      className={cx(
        "border-default flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
        "data-[drop-target]:border-primary data-[drop-target]:bg-primary/5",
        "data-[focus-visible]:border-primary outline-none",
        className
      )}
      getDropOperation={getDropOperation}
      onDrop={onDrop}
    >
      {children}
    </AriaDropZone>
  );
}

function DropZoneIcon({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-muted h-10 w-10", className)}>{children}</div>;
}

function DropZoneLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-foreground text-sm font-medium", className)}>{children}</div>;
}

function DropZoneDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-muted text-xs", className)}>{children}</div>;
}

interface DropZoneTriggerProps {
  children: ReactNode;
  acceptedFileTypes?: ReadonlyArray<string>;
  allowsMultiple?: boolean;
  onSelect?: (files: FileList | null) => void;
}

function DropZoneTrigger({
  children,
  acceptedFileTypes,
  allowsMultiple,
  onSelect,
}: DropZoneTriggerProps) {
  return (
    <FileTrigger
      acceptedFileTypes={acceptedFileTypes}
      allowsMultiple={allowsMultiple}
      onSelect={onSelect}
    >
      <Button className="mt-1" size="sm" variant="secondary">
        {children}
      </Button>
    </FileTrigger>
  );
}

export const DropZone = Object.assign(DropZoneRoot, {
  Area: DropZoneArea,
  Icon: DropZoneIcon,
  Label: DropZoneLabel,
  Description: DropZoneDescription,
  Trigger: DropZoneTrigger,
});

export default DropZone;
