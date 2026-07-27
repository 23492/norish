"use client";

import type { IngredientLinkCandidate } from "@norish/shared-react/text";

import { resolveCookRenderSteps } from "@norish/shared/cooklang";

import { useRecipeContext } from "../context";

import { ReadonlyStepsList } from "@/components/recipes/readonly-steps-list";

type StepsListProps = {
  onIngredientPress?: (candidate: IngredientLinkCandidate) => void;
};

export default function StepsList({ onIngredientPress }: StepsListProps = {}) {
  const context = useRecipeContext();
  const recipe = context?.recipe;
  const ingredients =
    context?.adjustedIngredients && context.adjustedIngredients.length > 0
      ? context.adjustedIngredients
      : (recipe?.recipeIngredients ?? []);
  // D-27-W4-03: pass the two servings numbers, never a pre-divided ratio.
  // D-27-W1-flag: systemUsed MUST be supplied so ingredient chip keys come
  // out as the `"metric:brown sugar"` form D-27-W4-09 requires.
  const cookSteps = resolveCookRenderSteps(recipe?.cookTokens, {
    baseServings: recipe?.servings,
    servings: context?.currentServings,
    systemUsed: recipe?.systemUsed,
  });

  return (
    <ReadonlyStepsList
      enableTimers
      interactive
      cookSteps={cookSteps}
      ingredients={ingredients}
      recipeId={recipe?.id}
      recipeName={recipe?.name}
      steps={recipe?.steps ?? []}
      systemUsed={recipe?.systemUsed ?? "metric"}
      onIngredientPress={onIngredientPress}
    />
  );
}
