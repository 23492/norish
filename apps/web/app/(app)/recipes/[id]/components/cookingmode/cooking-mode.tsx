"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import AmountDisplayToggle from "@/app/(app)/recipes/[id]/components/amount-display-toggle";
import { ReadonlyIngredientsList } from "@/app/(app)/recipes/[id]/components/ingredient-list";
import ServingsControl from "@/app/(app)/recipes/[id]/components/servings-control";
import SystemConvertMenu from "@/app/(app)/recipes/[id]/components/system-convert-menu";
import { useWakeLockContext } from "@/app/(app)/recipes/[id]/components/wake-lock-context";
import { SmartInstruction } from "@/components/recipe/smart-instruction";
import ImageLightbox from "@/components/shared/image-lightbox";
import { TimerDock } from "@/components/timer-dock";
import {
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FireIcon,
  ListBulletIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { Carousel } from "@heroui-pro/react";
import {
  Button,
  Card,
  Chip,
  Meter,
  Modal,
  ScrollShadow,
  Separator,
  Surface,
  Tabs,
  Tooltip,
} from "@heroui/react";
import { useTranslations } from "next-intl";

import type { ResolvedCookingModeStep } from "./cooking-mode-steps";
import { useRecipeContextRequired } from "../../context";
import { resolveCookingModeSteps } from "./cooking-mode-steps";

type CookingModeTab = "steps" | "ingredients";
type SwipePoint = {
  x: number;
  y: number;
};
type CookingModeProps = {
  className?: string;
  fullWidth?: boolean;
};

const SWIPE_THRESHOLD = 56;

function clampStep(step: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(Math.max(step, 0), total - 1);
}

function StepImages({
  className = "",
  step,
}: {
  className?: string;
  step: ResolvedCookingModeStep;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxInitialIndex, setLightboxInitialIndex] = useState(0);
  const lightboxImages = useMemo(
    () =>
      step.images.map((image, index) => ({
        src: image.image,
        alt: `Step ${step.stepNumber} image ${index + 1}`,
      })),
    [step.images, step.stepNumber]
  );

  const primaryImage = step.images[0];

  if (!primaryImage) {
    return null;
  }

  return (
    <div className={className}>
      {step.images.length === 1 ? (
        <div className="bg-surface-secondary relative aspect-video max-h-36 w-full max-w-sm overflow-hidden rounded-xl">
          <Image
            fill
            unoptimized
            priority
            alt={`Step ${step.stepNumber} image 1`}
            className="object-cover"
            sizes="(min-width: 768px) 520px, 92vw"
            src={primaryImage.image}
          />
          <Button
            fullWidth
            aria-label={`Open step ${step.stepNumber} image 1`}
            className="absolute inset-0 h-full min-h-0 rounded-xl bg-transparent p-0 hover:bg-black/10"
            variant="tertiary"
            onPress={() => {
              setLightboxInitialIndex(0);
              setLightboxOpen(true);
            }}
          />
        </div>
      ) : (
        <div className="w-full max-w-sm">
          <Carousel opts={{ loop: true }}>
            <Carousel.Content>
              {step.images.map((image, index) => (
                <Carousel.Item key={`${image.image}-${index}`}>
                  <div className="bg-surface-secondary relative aspect-video max-h-36 overflow-hidden rounded-xl">
                    <Image
                      fill
                      unoptimized
                      alt={`Step ${step.stepNumber} image ${index + 1}`}
                      className="object-cover"
                      sizes="(min-width: 768px) 384px, 92vw"
                      src={image.image}
                    />
                    <Button
                      fullWidth
                      aria-label={`Open step ${step.stepNumber} image ${index + 1}`}
                      className="absolute inset-0 h-full min-h-0 rounded-xl bg-transparent p-0 hover:bg-black/10"
                      variant="tertiary"
                      onPress={() => {
                        setLightboxInitialIndex(index);
                        setLightboxOpen(true);
                      }}
                    />
                  </div>
                </Carousel.Item>
              ))}
            </Carousel.Content>
            <Carousel.Previous className="bg-background/70 backdrop-blur-md" />
            <Carousel.Next className="bg-background/70 backdrop-blur-md" />
            <Carousel.Dots className="mt-2" />
          </Carousel>
        </div>
      )}

      <ImageLightbox
        backdropClassName="z-[1500]"
        containerClassName="z-[1501]"
        images={lightboxImages}
        initialIndex={lightboxInitialIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

function CookingStepView({
  activeStep,
  recipeId,
  recipeName,
  steps,
  onStepChange,
}: {
  activeStep: number;
  recipeId: string;
  recipeName: string;
  steps: ResolvedCookingModeStep[];
  onStepChange: (step: number) => void;
}) {
  const tCookMode = useTranslations("recipes.cookMode");
  const tCommon = useTranslations("common.actions");
  const step = steps[activeStep];
  const totalSteps = steps.length;
  const progressValue = totalSteps > 0 ? ((activeStep + 1) / totalSteps) * 100 : 0;
  const previousDisabled = activeStep <= 0;
  const nextDisabled = activeStep >= totalSteps - 1;

  if (!step) {
    return (
      <Surface
        className="text-muted flex min-h-64 items-center justify-center p-6"
        variant="secondary"
      >
        {tCookMode("steps")}
      </Surface>
    );
  }

  return (
    <div className="flex h-full min-h-0 p-4 pt-0 md:p-6 md:pt-0">
      <Card className="mx-auto flex min-h-0 w-full max-w-5xl flex-col rounded-2xl">
        <Card.Content className="min-h-0 flex-1 p-0">
          <ScrollShadow className="h-full px-5 py-5 md:px-8 md:py-6" size={64}>
            <div className="mx-auto w-full max-w-5xl">
              <div className="mx-auto flex max-w-3xl flex-col gap-6">
                <div className="order-1 flex min-w-0 items-center gap-3 md:gap-4">
                  <div className="bg-accent text-accent-foreground flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-semibold tabular-nums md:h-12 md:w-12 md:text-2xl">
                    {step.stepNumber}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {step.heading ? (
                      <Chip color="accent" variant="soft">
                        <BookOpenIcon className="size-4 translate-y-px" />
                        <Chip.Label>{step.heading}</Chip.Label>
                      </Chip>
                    ) : null}
                  </div>
                </div>

                <div className="text-foreground order-2 min-w-0 text-2xl leading-relaxed font-medium md:text-3xl md:leading-relaxed">
                  <SmartInstruction
                    recipeId={recipeId}
                    recipeName={recipeName}
                    stepIndex={step.originalIndex}
                    text={step.text}
                  />
                </div>

                <StepImages className="order-3" step={step} />
              </div>
            </div>
          </ScrollShadow>
        </Card.Content>

        <div className="border-border flex shrink-0 flex-col gap-3 border-t px-4 py-3 md:px-6 md:py-4">
          <Meter
            aria-label={tCookMode("stepCounter", {
              current: activeStep + 1,
              total: totalSteps,
            })}
            className="w-full"
            color="accent"
            value={progressValue}
          >
            <Meter.Track>
              <Meter.Fill />
            </Meter.Track>
          </Meter>

          <div className="flex items-center justify-between gap-3">
            <Tooltip delay={0}>
              <Button
                isIconOnly
                aria-label={tCommon("back")}
                isDisabled={previousDisabled}
                variant="secondary"
                onPress={() => onStepChange(clampStep(activeStep - 1, totalSteps))}
              >
                <ChevronUpIcon className="size-5 md:hidden" />
                <ChevronUpIcon className="hidden size-5 md:block" />
              </Button>
              <Tooltip.Content placement="top">{tCommon("back")}</Tooltip.Content>
            </Tooltip>

            <div className="text-muted text-sm font-medium tabular-nums">
              {tCookMode("stepCounter", {
                current: activeStep + 1,
                total: totalSteps,
              })}
            </div>

            <Tooltip delay={0}>
              <Button
                isIconOnly
                aria-label={nextDisabled ? tCommon("done") : tCommon("next")}
                isDisabled={nextDisabled}
                variant="primary"
                onPress={() => onStepChange(clampStep(activeStep + 1, totalSteps))}
              >
                <ChevronDownIcon className="size-5 md:hidden" />
                <ChevronDownIcon className="hidden size-5 md:block" />
              </Button>
              <Tooltip.Content placement="top">
                {nextDisabled ? tCommon("done") : tCommon("next")}
              </Tooltip.Content>
            </Tooltip>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function CookingMode({ className = "", fullWidth = false }: CookingModeProps) {
  const { adjustedIngredients, recipe } = useRecipeContextRequired();
  const { disable, enable, isActive, isSupported } = useWakeLockContext();
  const tDetail = useTranslations("recipes.detail");
  const tCookMode = useTranslations("recipes.cookMode");
  const tCommon = useTranslations("common.actions");
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CookingModeTab>("steps");
  const [activeStep, setActiveStep] = useState(0);
  const wakeLockOwnedRef = useRef(false);
  const swipeStartRef = useRef<SwipePoint | null>(null);

  const steps = useMemo(
    () => resolveCookingModeSteps(recipe.steps ?? [], recipe.systemUsed ?? "metric"),
    [recipe.steps, recipe.systemUsed]
  );
  const displayIngredients =
    adjustedIngredients?.length > 0 ? adjustedIngredients : recipe.recipeIngredients;
  const currentStep = clampStep(activeStep, steps.length);

  useEffect(() => {
    if (activeStep !== currentStep) {
      setActiveStep(currentStep);
    }
  }, [activeStep, currentStep]);

  useEffect(() => {
    if (!isOpen || !isSupported || isActive || wakeLockOwnedRef.current) {
      return;
    }

    wakeLockOwnedRef.current = true;
    void enable();
  }, [enable, isActive, isOpen, isSupported]);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    if (wakeLockOwnedRef.current) {
      wakeLockOwnedRef.current = false;
      disable();
    }
  }, [disable, isOpen]);

  useEffect(() => {
    return () => {
      if (wakeLockOwnedRef.current) {
        wakeLockOwnedRef.current = false;
        disable();
      }
    };
  }, [disable]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveTab("ingredients");
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveTab("steps");
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveTab("steps");
        setActiveStep((step) => clampStep(step + 1, steps.length));
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveTab("steps");
        setActiveStep((step) => clampStep(step - 1, steps.length));
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, steps.length]);

  const close = useCallback(() => setIsOpen(false), []);
  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === "mouse") {
      return;
    }

    swipeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
    };
  }, []);
  const handlePointerUp = useCallback(
    (event: React.PointerEvent) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;

      if (!start || event.pointerType === "mouse") {
        return;
      }

      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX > absY && absX > SWIPE_THRESHOLD) {
        setActiveTab(deltaX < 0 ? "ingredients" : "steps");
        return;
      }

      if (activeTab === "steps" && absY > absX && absY > SWIPE_THRESHOLD) {
        setActiveStep((step) => clampStep(step + (deltaY < 0 ? 1 : -1), steps.length));
      }
    },
    [activeTab, steps.length]
  );

  return (
    <>
      <Button
        className={className}
        fullWidth={fullWidth}
        variant="primary"
        onPress={() => {
          setActiveTab("steps");
          setIsOpen(true);
        }}
      >
        <FireIcon className="size-5" />
        {tDetail("cook")}
      </Button>

      <Modal.Backdrop
        isOpen={isOpen}
        className="bg-background/75 z-[1099]"
        variant="blur"
        onOpenChange={setIsOpen}
      >
        <Modal.Container className="z-[1100] items-center justify-center md:p-8" size="full">
          <Modal.Dialog className="flex items-center justify-center bg-transparent p-0">
            <div className="bg-background md:bg-surface flex h-[100dvh] w-screen flex-col overflow-hidden rounded-none md:h-[min(92dvh,900px)] md:w-[min(1180px,calc(100vw-4rem))] md:rounded-3xl md:shadow-2xl">
              <Tabs
                className="flex min-h-0 flex-1 flex-col"
                selectedKey={activeTab}
                onSelectionChange={(key) => setActiveTab(String(key) as CookingModeTab)}
              >
                <header className="flex shrink-0 flex-col gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 md:px-6 md:pt-5">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-muted text-xs font-semibold">{tDetail("cook")}</p>
                      <h2 className="truncate text-lg font-semibold md:text-xl">{recipe.name}</h2>
                    </div>
                    <Tooltip delay={0}>
                      <Button
                        isIconOnly
                        aria-label={tCommon("close")}
                        className="size-10 min-w-10 rounded-full"
                        variant="tertiary"
                        onPress={close}
                      >
                        <XMarkIcon className="size-5" />
                      </Button>
                      <Tooltip.Content placement="bottom">{tCommon("close")}</Tooltip.Content>
                    </Tooltip>
                  </div>

                  <Tabs.ListContainer>
                    <Tabs.List aria-label={tDetail("cook")} className="w-full">
                      <Tabs.Tab className="flex-1" id="steps">
                        <ListBulletIcon className="size-4" />
                        {tCookMode("steps")}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                      <Tabs.Tab className="flex-1" id="ingredients">
                        <BookOpenIcon className="size-4 md:translate-y-0.5" />
                        {tCookMode("ingredients")}
                        <Tabs.Indicator />
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs.ListContainer>
                </header>

                <Tabs.Panel
                  className="min-h-0 flex-1 overflow-hidden"
                  id="steps"
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUp}
                >
                  <CookingStepView
                    activeStep={currentStep}
                    recipeId={recipe.id}
                    recipeName={recipe.name}
                    steps={steps}
                    onStepChange={setActiveStep}
                  />
                </Tabs.Panel>

                <Tabs.Panel
                  className="min-h-0 flex-1 overflow-hidden p-4 pt-0 md:p-6 md:pt-0"
                  id="ingredients"
                  onPointerDown={handlePointerDown}
                  onPointerUp={handlePointerUp}
                >
                  <Card className="flex h-full min-h-0 flex-col overflow-hidden">
                    <Card.Header className="flex-col items-stretch gap-4 px-4 pt-4 md:flex-row md:items-center md:justify-between md:px-6 md:pt-6">
                      <div className="hidden md:block">
                        <Card.Title>{tCookMode("ingredients")}</Card.Title>
                        {recipe.servings ? (
                          <Card.Description>
                            {tCookMode("serving", { count: recipe.servings })}
                          </Card.Description>
                        ) : null}
                      </div>
                      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
                        <AmountDisplayToggle />
                        {recipe.servings ? <ServingsControl /> : null}
                        {recipe.systemUsed ? <SystemConvertMenu /> : null}
                      </div>
                    </Card.Header>
                    <Separator />
                    <Card.Content className="min-h-0 flex-1 overflow-hidden p-0">
                      <ScrollShadow className="h-full px-4 py-4 md:px-6" size={64}>
                        <ReadonlyIngredientsList
                          interactive
                          ingredients={displayIngredients}
                          systemUsed={recipe.systemUsed}
                        />
                      </ScrollShadow>
                    </Card.Content>
                  </Card>
                </Tabs.Panel>
              </Tabs>
              <TimerDock className="z-[1200]" />
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
