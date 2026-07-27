"use client";

import type { CookRenderStep } from "@norish/shared/cooklang";
import type { IngredientLinkCandidate } from "@norish/shared-react/text";

import React, { Fragment, useMemo, useState } from "react";
import Image from "next/image";
import { CheckIcon } from "@heroicons/react/16/solid";
import { createIngredientLinkCandidates } from "@norish/shared-react/text";

import { SmartInstruction } from "@/components/recipe/smart-instruction";
import ImageLightbox from "@/components/shared/image-lightbox";
import SmartMarkdownRenderer from "@/components/shared/smart-markdown-renderer";

type StepLike = {
  step: string;
  systemUsed: string;
  order: number;
  images?: Array<{ image: string }>;
};

type SmartInstructionLike = React.ComponentType<{
  text: string;
  recipeId: string;
  token?: string;
  recipeName?: string;
  stepIndex: number;
  ingredientCandidates?: IngredientLinkCandidate[];
  /** Cooklang token step for this row (Phase 27 W4). See `SmartInstruction`. */
  cookStep?: CookRenderStep;
  onIngredientPress?: (candidate: IngredientLinkCandidate) => void;
}>;

type IngredientLike = {
  ingredientName: string;
  amount?: number | string | null;
  unit?: string | null;
  systemUsed: string;
  order: number;
};

export type ReadonlyStepsListProps = {
  steps: StepLike[];
  systemUsed: string;
  interactive?: boolean;
  enableTimers?: boolean;
  recipeId?: string;
  token?: string;
  recipeName?: string;
  ingredients?: IngredientLike[];
  onIngredientPress?: (candidate: IngredientLinkCandidate) => void;
  /** Override the timer-aware instruction renderer (e.g. for public share pages). */
  InstructionComponent?: SmartInstructionLike;
  /**
   * Cooklang token render steps (Phase 27 W4, D-27-W4-01/13). `null`/`undefined`
   * (the common case until W5's backfill) keeps the existing `#`-sniffing
   * heuristic render, byte-for-byte. When non-null it is paired 1:1 with the
   * Nth non-heading legacy step; a count mismatch falls back to the legacy
   * branch in full, never a half-token render.
   */
  cookSteps?: CookRenderStep[] | null;
};

export function ReadonlyStepsList({
  steps,
  systemUsed,
  interactive = false,
  enableTimers = false,
  recipeId,
  token,
  recipeName,
  ingredients = [],
  onIngredientPress,
  InstructionComponent = SmartInstruction,
  cookSteps,
}: ReadonlyStepsListProps) {
  const [done, setDone] = useState<Set<number>>(() => new Set());
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<{ src: string; alt?: string }[]>([]);
  const [lightboxInitialIndex, setLightboxInitialIndex] = useState(0);

  const toggle = (i: number) => {
    if (!interactive) {
      return;
    }

    setDone((prev) => {
      const next = new Set(prev);

      if (next.has(i)) next.delete(i);
      else next.add(i);

      return next;
    });
  };

  const onKeyToggle = (e: React.KeyboardEvent, i: number) => {
    if (!interactive) {
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle(i);
    }
  };

  const openLightbox = (
    images: { src: string; alt?: string }[],
    index: number,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setLightboxImages(images);
    setLightboxInitialIndex(index);
    setLightboxOpen(true);
  };

  const filteredSteps = steps
    .filter((s) => s.systemUsed === systemUsed)
    .sort((a, b) => a.order - b.order);
  // D-27-W4-13: the Nth non-heading legacy row pairs with the Nth token
  // step. A count mismatch means a stale projection — fall back to the
  // legacy branch in FULL rather than a half-token render.
  const nonHeadingStepCount = filteredSteps.filter(
    (s) => !s.step.trim().startsWith("#")
  ).length;
  const useCookBranch = cookSteps != null && cookSteps.length === nonHeadingStepCount;
  const ingredientCandidates = useMemo(
    () => (useCookBranch ? undefined : createIngredientLinkCandidates(ingredients, systemUsed)),
    [ingredients, systemUsed, useCookBranch]
  );

  let stepNumber = 0;
  let cookStepCursor = 0;

  return (
    <>
      <ol className="space-y-3">
        {filteredSteps.map((s, i) => {
          const legacyIsHeading = s.step.trim().startsWith("#");

          // On the token branch the legacy `# Heading` projection row is
          // superseded by the paired cook step's own `section` (D-27-W4-05)
          // — it never consumed a step number and renders nothing here.
          if (useCookBranch && legacyIsHeading) return null;

          const cookStep = useCookBranch ? (cookSteps ?? [])[cookStepCursor] : undefined;

          if (useCookBranch) cookStepCursor += 1;

          if (!useCookBranch && legacyIsHeading) {
            const headingText = s.step.trim().replace(/^#+\s*/, "");

            return (
              <li key={i} className="list-none">
                <div className="px-3 py-2">
                  <h3 className="text-foreground text-base font-semibold">{headingText}</h3>
                </div>
              </li>
            );
          }

          const isDone = done.has(i);
          const stepImages = s.images || [];

          stepNumber += 1;
          const currentStepNumber = stepNumber;
          const sectionHeading =
            useCookBranch && cookStep?.isSectionStart && cookStep.section
              ? cookStep.section
              : null;

          const stepRow = (
            <li>
              <div
                aria-pressed={interactive ? isDone : undefined}
                className={`flex gap-4 rounded-xl p-3 transition-all duration-200 select-none ${
                  interactive ? "group hover:bg-surface-secondary cursor-pointer" : "bg-transparent"
                }`}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={() => toggle(i)}
                onKeyDown={(e) => onKeyToggle(e, i)}
              >
                <div className="bg-accent text-accent-foreground relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
                  <span
                    className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${
                      interactive && isDone ? "scale-0 opacity-0" : "scale-100 opacity-100"
                    }`}
                  >
                    {currentStepNumber}
                  </span>
                  {interactive ? (
                    <CheckIcon
                      className={`h-4 w-4 transition-all duration-200 ${
                        isDone ? "scale-100 opacity-100" : "scale-0 opacity-0"
                      }`}
                    />
                  ) : null}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div
                    className={`text-base leading-relaxed transition-all duration-200 ${
                      interactive && isDone ? "text-muted line-through" : "text-foreground"
                    }`}
                  >
                    {interactive && !isDone && enableTimers ? (
                      <InstructionComponent
                        cookStep={cookStep}
                        ingredientCandidates={ingredientCandidates}
                        recipeId={recipeId || ""}
                        recipeName={recipeName}
                        stepIndex={currentStepNumber - 1}
                        text={s.step}
                        token={token}
                        onIngredientPress={onIngredientPress}
                      />
                    ) : (
                      <SmartMarkdownRenderer
                        disableLinks={interactive && isDone}
                        ingredientCandidates={ingredientCandidates}
                        text={s.step}
                        onIngredientPress={onIngredientPress}
                      />
                    )}
                  </div>

                  {stepImages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {stepImages.map((img, imgIndex) => (
                        <button
                          key={imgIndex}
                          className={`group/img ring-border focus:ring-accent relative h-16 w-16 overflow-hidden rounded-lg shadow-sm ring-1 transition-all duration-200 focus:ring-2 focus:outline-none md:h-20 md:w-20 ${
                            interactive && isDone
                              ? "opacity-50 grayscale"
                              : "hover:ring-accent hover:scale-105 hover:shadow-md"
                          }`}
                          type="button"
                          onClick={(e) =>
                            openLightbox(
                              stepImages.map((si, imageIndex) => ({
                                src: si.image,
                                alt: `Step ${currentStepNumber} image ${imageIndex + 1}`,
                              })),
                              imgIndex,
                              e
                            )
                          }
                        >
                          <Image
                            fill
                            unoptimized
                            alt={`Step ${currentStepNumber} image ${imgIndex + 1}`}
                            className="object-cover"
                            src={img.image}
                          />
                          <div className="absolute inset-0 bg-black/0 transition-colors group-hover/img:bg-black/10" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );

          if (sectionHeading) {
            return (
              <Fragment key={i}>
                <li className="list-none">
                  <div className="px-3 py-2">
                    <h3 className="text-foreground text-base font-semibold">{sectionHeading}</h3>
                  </div>
                </li>
                {stepRow}
              </Fragment>
            );
          }

          return <Fragment key={i}>{stepRow}</Fragment>;
        })}
      </ol>

      <ImageLightbox
        images={lightboxImages}
        initialIndex={lightboxInitialIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </>
  );
}
