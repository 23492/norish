"use client";

import type { CookRenderStep } from "@norish/shared/cooklang";
import type { IngredientLinkCandidate } from "@norish/shared-react/text";

import { cookStepTimers, cookStepToMarkdown } from "@norish/shared/cooklang";

import SmartMarkdownRenderer from "@/components/shared/smart-markdown-renderer";
import { useTimerKeywordsQuery, useTimersEnabledQuery } from "@/hooks/config";
import { useUnitFormatter } from "@/hooks/use-unit-formatter";

interface SmartInstructionProps {
  text: string;
  recipeId: string;
  recipeName?: string;
  stepIndex: number;
  ingredientCandidates?: IngredientLinkCandidate[];
  /**
   * When present, the step renders from its Cooklang tokens instead of
   * scanning `text` for ingredients/timers (Phase 27 W4, D-27-W4-01/11):
   * `text` is ignored, `ingredientCandidates` is never built by the caller,
   * and the heuristic (`createIngredientLinkCandidates`, `parseTimerDurations`)
   * is never invoked on this branch.
   */
  cookStep?: CookRenderStep;
  onIngredientPress?: (candidate: IngredientLinkCandidate) => void;
}

export function SmartInstruction({
  text,
  recipeId,
  recipeName,
  stepIndex,
  ingredientCandidates,
  cookStep,
  onIngredientPress,
}: SmartInstructionProps) {
  const { timersEnabled } = useTimersEnabledQuery();
  const { timerKeywords } = useTimerKeywordsQuery();
  const { formatAmountUnit } = useUnitFormatter();

  const keywords = {
    hours: timerKeywords.hours,
    minutes: timerKeywords.minutes,
    seconds: timerKeywords.seconds,
  };

  const resolvedText = cookStep
    ? cookStepToMarkdown(cookStep, {
        ingredientAmountLabel: (token) => formatAmountUnit(token.amount, token.unit),
        timerLabel: (timer) => timer.name ?? "Timer",
      })
    : text;

  return (
    <SmartMarkdownRenderer
      ingredientCandidates={cookStep ? undefined : ingredientCandidates}
      text={resolvedText}
      timerConfig={{
        enabled: timersEnabled && timerKeywords.enabled,
        keywords,
        recipeId,
        recipeName,
        stepIndex,
        ...(cookStep ? { tokens: cookStepTimers(cookStep, keywords) } : {}),
      }}
      onIngredientPress={onIngredientPress}
    />
  );
}
