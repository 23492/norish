"use client";

import type { CookingModeDialogProps } from "./types";
import { CookingModeTabs } from "./cooking-mode-tabs";

export function DesktopCookingModeDialog(props: CookingModeDialogProps) {
  return (
    <div className="bg-surface flex h-[min(92dvh,900px)] w-[min(1180px,calc(100vw-4rem))] flex-col overflow-hidden rounded-3xl shadow-2xl">
      <CookingModeTabs {...props} showIngredientsTitle />
    </div>
  );
}
