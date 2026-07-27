/**
 * Maps FullRecipeDTO.steps into the shape consumed by RecipeSteps and CookMode.
 */

import type { FullRecipeDTO } from "@norish/shared/contracts";
import type { CookRenderStep } from "@norish/shared/cooklang";

import { resolveCookRenderSteps } from "@norish/shared/cooklang";

import { resolveImageUri } from "./resolve-image-url";

/** The shape RecipeSteps and CookMode components expect */
export type MappedStep = {
  /** The instruction text (may contain markdown formatting) */
  text: string;
  /** Optional images attached to this step */
  images?: { image: string }[];
  /**
   * The paired Cooklang token render step (Phase 27 W4, D-27-W4-13). Present
   * only when the recipe carries `cookTokens` AND the non-heading legacy step
   * count matches the token step count 1:1; otherwise every step in the
   * array has `cookStep: undefined` — the whole-recipe legacy fallback.
   * When present, the caller renders from `cookStep` (name/amount/unit/
   * section/timers come from the token) instead of scanning `text`.
   */
  cookStep?: CookRenderStep;
};

type StepLike = NonNullable<FullRecipeDTO["steps"]>[number];

function isHeadingRow(step: StepLike): boolean {
  return (step.step ?? "").trim().startsWith("#");
}

function mapImages(step: StepLike, backendBaseUrl: string | null): { image: string }[] | undefined {
  return step.images && step.images.length > 0
    ? step.images.map((img) => ({
        image: resolveImageUri(img.image, backendBaseUrl),
      }))
    : undefined;
}

/**
 * Transform FullRecipeDTO.steps into MappedStep[], resolving image URLs.
 * Steps are sorted by their `order` field.
 *
 * `servings` is the CURRENT servings being viewed/cooked (the recipe's own
 * `servings` is the base) — D-27-W4-03: the two numbers are passed through
 * to `resolveCookRenderSteps`, never a pre-divided ratio, so in-step token
 * amounts rescale through the exact same expression the ingredient list
 * uses.
 *
 * With `recipe.cookTokens` absent (still the common case until W5's
 * backfill), or when the non-heading step count disagrees with the token
 * step count (a stale projection, D-27-W4-13), every returned step has
 * `cookStep: undefined` and the array is IDENTICAL, field for field, to the
 * pre-Phase-27-W4 output — the legacy `#`-sniffing render path stays
 * unchanged.
 */
export function mapRecipeToSteps(
  recipe: FullRecipeDTO,
  backendBaseUrl: string | null,
  servings?: number | null
): MappedStep[] {
  const sorted = [...(recipe.steps ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const cookSteps = resolveCookRenderSteps(recipe.cookTokens, {
    baseServings: recipe.servings,
    servings,
    systemUsed: recipe.systemUsed,
  });

  const nonHeadingSteps = sorted.filter((step) => !isHeadingRow(step));
  const useCookBranch = cookSteps != null && cookSteps.length === nonHeadingSteps.length;

  if (useCookBranch) {
    // The `# Heading` projection rows are excluded entirely — the paired
    // cook step's own `section`/`isSectionStart` is what surfaces a heading
    // on this branch (D-27-W4-05).
    return nonHeadingSteps.map((step, index) => ({
      text: step.step ?? "",
      images: mapImages(step, backendBaseUrl),
      cookStep: cookSteps[index],
    }));
  }

  return sorted.map((step) => ({
    text: step.step ?? "",
    images: mapImages(step, backendBaseUrl),
  }));
}
