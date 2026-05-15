"use client";

import { use, useEffect, useMemo, useState } from "react";
import AmountDisplayToggle from "@/app/(app)/recipes/[id]/components/amount-display-toggle";
import AuthorChip from "@/app/(app)/recipes/[id]/components/author-chip";
import { ReadonlyIngredientsList } from "@/app/(app)/recipes/[id]/components/ingredient-list";
import { ReadonlyStepsList } from "@/app/(app)/recipes/[id]/components/steps-list";
import { MOBILE_RECIPE_MEDIA_HEIGHT_STYLE } from "@/app/(app)/recipes/[id]/recipe-layout-constants";
import { PublicSmartInstruction } from "@/components/recipe/public-smart-instruction";
import {
  ReadonlyNutritionCard,
  ReadonlyNutritionSection,
} from "@/components/recipes/nutrition-card";
import {
  ReadonlyRecipeMedia,
  ReadonlyRecipeNotes,
  ReadonlyRecipeSummary,
} from "@/components/recipes/readonly-recipe-sections";
import AuthLanguageSelector from "@/components/shared/auth-language-selector";
import { NotFoundView } from "@/components/shared/not-found-view";
import RecipeSkeleton from "@/components/skeleton/recipe-skeleton";
import { TimerTicker } from "@/components/timer-dock";
import { sharedRecipeShareHooks } from "@/hooks/recipes/shared-recipe-hooks";
import { useSharePublicConfigQuery } from "@/hooks/recipes/use-share-public-config-query";
import { ArrowsRightLeftIcon, MinusIcon, PlusIcon } from "@heroicons/react/16/solid";
import { Button, Card, Dropdown, Label, Separator } from "@heroui/react";
import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";

import type { MeasurementSystem } from "@norish/shared/contracts";

type Props = {
  params: Promise<{
    token: string;
  }>;
};

/* ── Standalone servings control for public share pages ────────────── */

function formatServings(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, "");
}
function ShareServingsControl({
  servings,
  onChange,
}: {
  servings: number;
  onChange: (v: number) => void;
}) {
  const dec = () => {
    if (servings <= 1) onChange(Math.max(0.125, servings / 2));
    else if (servings <= 2) onChange(1);
    else onChange(servings - 1);
  };
  const inc = () => {
    if (servings < 1) onChange(Math.min(1, servings * 2));
    else onChange(servings + 1);
  };
  return (
    <div className="inline-flex items-center gap-2">
      <Button
        isIconOnly
        aria-label="Decrease servings"
        className="bg-surface-secondary"
        size="sm"
        onPress={dec}
        variant="tertiary"
      >
        <MinusIcon className="h-4 w-4" />
      </Button>
      <span className="min-w-8 text-center text-sm">{formatServings(servings)}</span>
      <Button
        isIconOnly
        aria-label="Increase servings"
        className="bg-surface-secondary"
        size="sm"
        onPress={inc}
        variant="tertiary"
      >
        <PlusIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ── Standalone system switcher (data-only, no AI conversion) ──────── */

function ShareSystemSwitcher({
  availableSystems,
  activeSystem,
  onChange,
}: {
  availableSystems: MeasurementSystem[];
  activeSystem: MeasurementSystem;
  onChange: (system: MeasurementSystem) => void;
}) {
  const t = useTranslations("recipes.convert");
  if (availableSystems.length <= 1) return null;
  return (
    <Dropdown>
      <Button
        className="bg-surface-secondary text-foreground min-w-16 capitalize transition-opacity duration-150 data-[hovered=true]:opacity-80"
        size="sm"
        variant="tertiary"
      >
        {<ArrowsRightLeftIcon className="h-4 w-4" />}
        {activeSystem}
      </Button>

      <Dropdown.Popover className="bg-overlay">
        <Dropdown.Menu aria-label={t("ariaLabel")}>
          {availableSystems.map((sys) => (
            <Dropdown.Item
              id={sys}
              key={sys}
              className="capitalize"
              textValue={sys === "metric" ? t("toMetric") : t("toUS")}
              onPress={() => {
                if (sys !== activeSystem) onChange(sys);
              }}
            >
              {sys === activeSystem ? <Dropdown.ItemIndicator /> : null}
              <Label>{sys === "metric" ? t("toMetric") : t("toUS")}</Label>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/* ── Shared state hook for share page recipe adjustments ───────────── */

type IngredientLike = {
  ingredientName: string;
  amount: number | null;
  unit: string | null;
  systemUsed: string;
  order: number;
};
function useShareRecipeState(recipe: {
  servings: number;
  systemUsed: MeasurementSystem;
  recipeIngredients: IngredientLike[];
}) {
  const [servings, setServings] = useState(Math.max(0.125, recipe.servings));
  const [activeSystem, setActiveSystem] = useState<MeasurementSystem>(recipe.systemUsed);
  const availableSystems = useMemo(
    () =>
      Array.from(
        new Set(recipe.recipeIngredients.map((ri) => ri.systemUsed))
      ) as MeasurementSystem[],
    [recipe.recipeIngredients]
  );
  const ratio = servings / recipe.servings;
  const adjustedIngredients = useMemo(
    () =>
      recipe.recipeIngredients.map((ing) => ({
        ...ing,
        amount: ing.amount != null ? ing.amount * ratio : null,
      })),
    [recipe.recipeIngredients, ratio]
  );
  return {
    servings,
    setServings,
    activeSystem,
    setActiveSystem,
    availableSystems,
    adjustedIngredients,
  };
}

/* ── Desktop layout ───────────────────────────────────────────────── */

function SharedRecipePageDesktop({ token }: { token: string }) {
  const t = useTranslations("recipes.detail");
  const { recipe } = sharedRecipeShareHooks.useSharedRecipeQuery(token);
  const { units } = useSharePublicConfigQuery(token);
  const state = useShareRecipeState(
    recipe ?? {
      servings: 1,
      systemUsed: "metric",
      recipeIngredients: [],
    }
  );
  if (!recipe) return null;
  return (
    <div className="hidden flex-col space-y-6 px-6 pt-6 pb-10 md:flex">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-2">
          <Card className="bg-surface rounded-2xl shadow-md">
            <Card.Content className="p-6">
              <ReadonlyRecipeSummary recipe={recipe} />
            </Card.Content>
          </Card>

          <Card className="bg-surface rounded-2xl shadow-md">
            <Card.Content className="space-y-4 p-6">
              <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
                <h2 className="text-lg font-semibold">{t("ingredients")}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <AmountDisplayToggle />
                  <ShareServingsControl
                    baseServings={recipe.servings}
                    servings={state.servings}
                    onChange={state.setServings}
                  />
                  <ShareSystemSwitcher
                    activeSystem={state.activeSystem}
                    availableSystems={state.availableSystems}
                    onChange={state.setActiveSystem}
                  />
                </div>
              </div>
              <ReadonlyIngredientsList
                interactive
                ingredients={state.adjustedIngredients}
                systemUsed={state.activeSystem}
                units={units}
              />
            </Card.Content>
          </Card>

          <ReadonlyNutritionCard recipe={recipe} />
        </div>

        <div className="flex flex-col gap-6 md:col-span-1 lg:col-span-3">
          <ReadonlyRecipeMedia rounded recipe={recipe} />

          {recipe.notes && (
            <Card className="bg-surface rounded-2xl shadow-md">
              <Card.Header className="px-6 pt-6">
                <h2 className="text-lg font-semibold">{t("notes")}</h2>
              </Card.Header>
              <Card.Content className="p-6 pt-0">
                <ReadonlyRecipeNotes notes={recipe.notes} />
              </Card.Content>
            </Card>
          )}

          <Card className="bg-surface rounded-2xl shadow-md">
            <Card.Header className="px-6 pt-6">
              <h2 className="text-lg font-semibold">{t("steps")}</h2>
            </Card.Header>
            <Card.Content className="px-3 pt-2 pb-4">
              <ReadonlyStepsList
                enableTimers
                interactive
                InstructionComponent={PublicSmartInstruction}
                recipeId={token}
                recipeName={recipe.name}
                steps={recipe.steps}
                systemUsed={state.activeSystem}
                token={token}
              />
            </Card.Content>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── Mobile layout ────────────────────────────────────────────────── */

function SharedRecipePageMobile({ token }: { token: string }) {
  const t = useTranslations("recipes.detail");
  const { recipe } = sharedRecipeShareHooks.useSharedRecipeQuery(token);
  const { units } = useSharePublicConfigQuery(token);
  const state = useShareRecipeState(
    recipe ?? {
      servings: 1,
      systemUsed: "metric",
      recipeIngredients: [],
    }
  );
  if (!recipe) return null;
  return (
    <div className="-mx-4 -mt-4 flex w-[calc(100%+2rem)] flex-col md:hidden">
      <div
        className="relative w-full overflow-hidden"
        style={{
          height: MOBILE_RECIPE_MEDIA_HEIGHT_STYLE,
        }}
      >
        <ReadonlyRecipeMedia
          aspectRatio="4/3"
          className="h-full rounded-none shadow-none"
          recipe={recipe}
          rounded={false}
          topLeftContent={
            recipe.author ? (
              <div className="mt-2">
                <AuthorChip image={recipe.author.image} name={recipe.author.name} />
              </div>
            ) : null
          }
          topRightContent={
            <div className="mt-2">
              <AuthLanguageSelector />
            </div>
          }
        />
      </div>

      <Card className="bg-surface relative z-10 -mt-6 overflow-visible rounded-t-3xl rounded-b-none shadow-sm">
        <Card.Content className="space-y-6 px-4 py-5">
          <ReadonlyRecipeSummary recipe={recipe} timeVariant="mobile" />

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t("ingredients")}</h2>
              <div className="flex items-center gap-2">
                <AmountDisplayToggle />
                <ShareServingsControl
                  baseServings={recipe.servings}
                  servings={state.servings}
                  onChange={state.setServings}
                />
                <ShareSystemSwitcher
                  activeSystem={state.activeSystem}
                  availableSystems={state.availableSystems}
                  onChange={state.setActiveSystem}
                />
              </div>
            </div>
            <div className="-mx-1">
              <ReadonlyIngredientsList
                interactive
                ingredients={state.adjustedIngredients}
                systemUsed={state.activeSystem}
                units={units}
              />
            </div>
          </div>

          {recipe.notes && (
            <>
              <Separator />
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">{t("notes")}</h2>
                <ReadonlyRecipeNotes notes={recipe.notes} />
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("steps")}</h2>
            <div className="-mx-1">
              <ReadonlyStepsList
                enableTimers
                interactive
                InstructionComponent={PublicSmartInstruction}
                recipeId={token}
                recipeName={recipe.name}
                steps={recipe.steps}
                systemUsed={state.activeSystem}
                token={token}
              />
            </div>
          </div>

          <ReadonlyNutritionSection recipe={recipe} />
        </Card.Content>
      </Card>

      <div className="pb-5" />
    </div>
  );
}

/* ── Page entry ────────────────────────────────────────────────────── */

function SharedRecipePageContent({ token }: { token: string }) {
  const { recipe, isLoading, error } = sharedRecipeShareHooks.useSharedRecipeQuery(token);
  const t = useTranslations("recipes.detail");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  if (isLoading) {
    return <RecipeSkeleton />;
  }
  if (!recipe || (error instanceof TRPCClientError && error.data?.code === "NOT_FOUND")) {
    return <NotFoundView message={t("notFoundMessage")} title={t("notFound")} />;
  }
  return (
    <>
      <TimerTicker />
      <div className="hidden justify-end pt-4 md:flex md:px-6">
        <AuthLanguageSelector />
      </div>
      <SharedRecipePageDesktop token={token} />
      <SharedRecipePageMobile token={token} />
    </>
  );
}
export default function SharedRecipePage({ params }: Props) {
  const { token } = use(params);
  return <SharedRecipePageContent token={token} />;
}
