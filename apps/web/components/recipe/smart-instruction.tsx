"use client";

import type { CookRenderIngredientToken, CookRenderStep } from "@norish/shared/cooklang";
import type { IngredientLinkCandidate } from "@norish/shared-react/text";

import { useTranslations } from "next-intl";
import { cookStepTimers, cookStepToMarkdown } from "@norish/shared/cooklang";
import { normalizeIngredientLinkName } from "@norish/shared-react/text";

import SmartMarkdownRenderer from "@/components/shared/smart-markdown-renderer";
import { useTimerKeywordsQuery, useTimersEnabledQuery } from "@/hooks/config";
import { useUnitFormatter } from "@/hooks/use-unit-formatter";

/**
 * Builds the SAME `IngredientLinkCandidate` shape `createIngredientLinkCandidates`
 * produces, resolved DIRECTLY from the step's own ingredient tokens instead of
 * scanning the ingredient list — the per-token counterpart to `cookStepTimers`
 * (D-27-W4-09). Each token already carries the precomputed `key`
 * (`getIngredientLinkCandidateKey`, T1's `resolveCookRenderSteps`), so the
 * chip's press event and `readonly-ingredients-list.tsx`'s
 * `data-ingredient-link-key` anchors resolve to the exact same key the legacy
 * heuristic path would have produced for the same ingredient.
 */
function cookStepIngredientCandidates(cookStep: CookRenderStep): IngredientLinkCandidate[] {
  return cookStep.tokens
    .filter((token): token is CookRenderIngredientToken => token.type === "ingredient")
    .map((token, order) => {
      const colonIndex = token.key.indexOf(":");
      const systemUsed = colonIndex === -1 ? "" : token.key.slice(0, colonIndex);

      return {
        key: token.key,
        ingredientName: token.name,
        amount: token.amount,
        unit: token.unit,
        normalizedName: normalizeIngredientLinkName(token.name),
        systemUsed,
        order,
      };
    });
}

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
  const t = useTranslations("common");

  const keywords = {
    hours: timerKeywords.hours,
    minutes: timerKeywords.minutes,
    seconds: timerKeywords.seconds,
  };
  // The same i18n key T3 added to smart-markdown-renderer.tsx
  // (common.timer.step_fallback_label) — the last hard-coded English timer
  // label ("Timer") in the tree lived here, as the `cookStepToMarkdown`
  // fallback shown when an unnamed timer token's chip can't resolve (timers
  // disabled / link mode disabled).
  const timerFallbackLabel = t("timer.step_fallback_label", { step: stepIndex + 1 });

  const resolvedText = cookStep
    ? cookStepToMarkdown(cookStep, {
        ingredientAmountLabel: (token) => formatAmountUnit(token.amount, token.unit),
        timerLabel: (timer) => timer.name ?? timerFallbackLabel,
      })
    : text;
  // Per-token candidate resolution (D-27-W4-09): mirrors the
  // `timerConfig.tokens` escape hatch above — resolve the chip against the
  // step's own tokens instead of a name scan, so the chip stays interactive
  // and keyed exactly like the legacy branch.
  const resolvedIngredientCandidates = cookStep
    ? cookStepIngredientCandidates(cookStep)
    : ingredientCandidates;

  return (
    <SmartMarkdownRenderer
      ingredientCandidates={resolvedIngredientCandidates}
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
