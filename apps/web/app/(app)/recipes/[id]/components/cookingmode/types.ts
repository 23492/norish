import type { PointerEvent, Ref } from "react";

import type { CookRenderStep } from "@norish/shared/cooklang";
import type { IngredientLinkCandidate } from "@norish/shared-react/text";

import type { ResolvedCookingModeStep } from "./cooking-mode-steps";

export type CookingModeTab = "steps" | "ingredients";

export type IngredientLike = {
  ingredientName: string;
  amount: number | null;
  unit: string | null;
  systemUsed: string;
  order: number;
};

export type CookingModeDialogProps = {
  activeStep: number;
  activeTab: CookingModeTab;
  displayIngredients: IngredientLike[];
  recipeId: string;
  recipeName: string;
  recipeServings?: number | null;
  recipeSystemUsed: string;
  steps: ResolvedCookingModeStep[];
  /**
   * Cooklang token render steps (Phase 27 W4, D-27-W4-01/13). `null` (the
   * common case until W5's backfill) keeps the existing heuristic render,
   * byte-for-byte. When non-null it is paired 1:1 with the Nth
   * `resolveCookingModeSteps` row; a count mismatch falls back to the
   * legacy branch in full, never a half-token render.
   */
  cookSteps: CookRenderStep[] | null;
  highlightedIngredientKey?: string | null;
  ingredientListRef?: Ref<HTMLUListElement>;
  onClose: () => void;
  onIngredientPress?: (candidate: IngredientLinkCandidate) => void;
  onPointerDown: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onStepChange: (step: number) => void;
  onTabChange: (tab: CookingModeTab) => void;
};
