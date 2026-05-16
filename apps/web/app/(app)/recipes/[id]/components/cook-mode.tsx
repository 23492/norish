"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { SmartInstruction } from "@/components/recipe/smart-instruction";
import SmartMarkdownRenderer from "@/components/shared/smart-markdown-renderer";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import { Button, Modal, Tabs } from "@heroui/react";
import { useTranslations } from "next-intl";

import type { FullRecipeDTO } from "@norish/shared/contracts";

import AmountDisplayToggle from "./amount-display-toggle";
import IngredientsList from "./ingredient-list";
import ServingsControl from "./servings-control";

type CookModeProps = {
  recipe: FullRecipeDTO;
};

type CookStep = {
  originalIndex: number;
  stepNumber: number;
  text: string;
  heading?: string;
  images?: NonNullable<FullRecipeDTO["steps"][number]["images"]>;
};

type CookTab = "steps" | "ingredients";

const SWIPE_THRESHOLD = 50;

function resolveCookSteps(recipe: FullRecipeDTO): CookStep[] {
  const steps = (recipe.steps ?? [])
    .filter((step) => step.systemUsed === recipe.systemUsed)
    .sort((a, b) => a.order - b.order);
  const resolved: CookStep[] = [];
  let heading: string | undefined;
  let stepNumber = 0;

  steps.forEach((step, originalIndex) => {
    if (step.step.trim().startsWith("#")) {
      heading = step.step.trim().replace(/^#+\s*/, "");
      return;
    }

    stepNumber += 1;
    resolved.push({
      originalIndex,
      stepNumber,
      text: step.step,
      heading,
      images: step.images,
    });
  });

  return resolved;
}

export function CookModeButton({ recipe }: CookModeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const t = useTranslations("recipes");

  return (
    <>
      <Button fullWidth onPress={() => setIsOpen(true)} variant="secondary">
        {t("form.cook")}
      </Button>
      {isOpen ? <CookModeModal isOpen={isOpen} recipe={recipe} onOpenChange={setIsOpen} /> : null}
    </>
  );
}

function CookModeModal({
  isOpen,
  recipe,
  onOpenChange,
}: CookModeProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("recipes.cookMode");
  const steps = useMemo(() => resolveCookSteps(recipe), [recipe]);
  const [activeTab, setActiveTab] = useState<CookTab>("steps");
  const [currentStep, setCurrentStep] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const totalSteps = steps.length;
  const step = steps[currentStep];
  const goToPrevious = useCallback(() => {
    setCurrentStep((current) => Math.max(0, current - 1));
  }, []);
  const goToNext = useCallback(() => {
    setCurrentStep((current) => Math.min(totalSteps - 1, current + 1));
  }, [totalSteps]);
  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      const start = pointerStart.current;

      pointerStart.current = null;
      if (!start) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        setActiveTab(dx < 0 ? "ingredients" : "steps");
        return;
      }

      if (activeTab === "steps" && Math.abs(dy) > SWIPE_THRESHOLD) {
        if (dy < 0) goToNext();
        else goToPrevious();
      }
    },
    [activeTab, goToNext, goToPrevious]
  );

  return (
    <Modal>
      <Modal.Backdrop className="z-[1099]" isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container className="z-[1100]">
          <Modal.Dialog className="bg-background h-dvh w-screen max-w-none rounded-none p-0">
            {({ close }) => (
              <div className="flex h-full min-h-0 flex-col">
                <div className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-base font-semibold">
                      {recipe.name}
                    </div>
                  </div>
                  <Button isIconOnly aria-label="Close" onPress={close} variant="tertiary">
                    <XMarkIcon className="h-5 w-5" />
                  </Button>
                </div>

                <Tabs
                  className="flex min-h-0 flex-1 flex-col"
                  selectedKey={activeTab}
                  onSelectionChange={(key) => setActiveTab(key as CookTab)}
                >
                  <Tabs.ListContainer className="shrink-0 px-4 pt-3">
                    <Tabs.List aria-label="Cook mode sections" className="w-full">
                      <Tabs.Tab id="steps">
                        {t("steps")}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab id="ingredients">
                        {t("ingredients")}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>

                  <Tabs.Panel
                    className="min-h-0 flex-1"
                    id="steps"
                    onPointerDown={(event) => {
                      pointerStart.current = { x: event.clientX, y: event.clientY };
                    }}
                    onPointerUp={handlePointerUp}
                  >
                    {step ? (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 overflow-y-auto px-6 py-8">
                          {step.heading ? (
                            <div className="bg-accent/10 text-accent w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase">
                              {step.heading}
                            </div>
                          ) : null}
                          <div className="bg-accent text-accent-foreground flex h-12 w-12 items-center justify-center rounded-full text-xl font-bold">
                            {step.stepNumber}
                          </div>
                          <div className="text-foreground text-2xl leading-relaxed">
                            <SmartInstruction
                              recipeId={recipe.id}
                              recipeName={recipe.name}
                              stepIndex={step.originalIndex}
                              text={step.text}
                            />
                          </div>
                          {step.images && step.images.length > 0 ? (
                            <div className="flex flex-wrap gap-3">
                              {step.images.map((image, index) => (
                                <div
                                  key={`${image.image}-${index}`}
                                  className="relative h-24 w-24 overflow-hidden rounded-xl"
                                >
                                  <Image
                                    fill
                                    unoptimized
                                    alt={`Step ${step.stepNumber} image ${index + 1}`}
                                    className="object-cover"
                                    src={image.image}
                                  />
                                </div>
                              ))}
                            </div>
                          ) : null}
                          <div className="text-muted flex flex-col gap-1 text-xs">
                            <span>{t("swipeSteps")}</span>
                            <span>{t("swipeIngredients")}</span>
                          </div>
                        </div>
                        <div className="border-border flex shrink-0 items-center justify-between gap-4 border-t px-5 py-4">
                          <Button
                            isIconOnly
                            aria-label="Previous step"
                            isDisabled={currentStep === 0}
                            onPress={goToPrevious}
                            variant="tertiary"
                          >
                            <ArrowUpIcon className="h-5 w-5" />
                          </Button>
                          <div className="text-center">
                            <div className="text-base font-semibold">
                              {t("stepCounter", { current: currentStep + 1, total: totalSteps })}
                            </div>
                            <div className="mt-2 flex justify-center gap-1">
                              {steps.map((item, index) => (
                                <button
                                  key={item.originalIndex}
                                  aria-label={`Go to step ${index + 1}`}
                                  className={`h-1.5 rounded-full transition-all ${
                                    index === currentStep ? "bg-accent w-5" : "bg-muted/30 w-1.5"
                                  }`}
                                  type="button"
                                  onClick={() => setCurrentStep(index)}
                                />
                              ))}
                            </div>
                          </div>
                          <Button
                            isIconOnly
                            aria-label="Next step"
                            isDisabled={currentStep >= totalSteps - 1}
                            onPress={goToNext}
                            variant="tertiary"
                          >
                            <ArrowDownIcon className="h-5 w-5" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-muted flex h-full items-center justify-center">
                        <SmartMarkdownRenderer text={recipe.description ?? ""} />
                      </div>
                    )}
                  </Tabs.Panel>

                  <Tabs.Panel
                    className="min-h-0 flex-1 overflow-y-auto px-5 py-4"
                    id="ingredients"
                    onPointerDown={(event) => {
                      pointerStart.current = { x: event.clientX, y: event.clientY };
                    }}
                    onPointerUp={handlePointerUp}
                  >
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <span className="text-muted text-sm font-medium">{t("servings")}</span>
                      <div className="flex items-center gap-2">
                        <AmountDisplayToggle />
                        <ServingsControl />
                      </div>
                    </div>
                    <IngredientsList />
                    <div className="text-muted mt-6 flex items-center justify-center gap-1.5 text-xs">
                      <ArrowRightIcon className="h-4 w-4" />
                      {t("swipeBackToSteps")}
                    </div>
                  </Tabs.Panel>
                </Tabs>
              </div>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
