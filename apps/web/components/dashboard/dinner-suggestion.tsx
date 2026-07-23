"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import UserAvatar from "@/components/shared/user-avatar";
import { useUserContext } from "@/context/user-context";
import { useRecipeRatersQuery } from "@/hooks/ratings";
import { useDinnerSuggestion } from "@/hooks/recipes";
import {
  ArrowPathIcon,
  PhotoIcon,
  SparklesIcon,
  StarIcon as StarOutline,
} from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { Button, Card, Chip } from "@heroui/react";
import { useTranslations } from "next-intl";

import { getShowRatingsPreference } from "@norish/shared/lib/user-preferences";

/** Read-only 5-star row for a single score. */
function StaticStars({ rating }: { rating: number }) {
  return (
    <div aria-hidden className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) =>
        star <= rating ? (
          <StarSolid key={star} className="text-warning h-3.5 w-3.5" />
        ) : (
          <StarOutline key={star} className="text-default-300 h-3.5 w-3.5" />
        )
      )}
    </div>
  );
}

/**
 * The "someone loved this" thought-bubble. Data comes from the ACCESS-GATED
 * ratings.getRaters query (RATE-01): a user who cannot view the recipe gets
 * FORBIDDEN -> no raters -> this renders nothing, so it never leaks a name.
 */
function RaterThoughtBubble({ recipeId }: { recipeId: string }) {
  const t = useTranslations("recipes.dinner");
  const tDetail = useTranslations("recipes.detail");
  const { user } = useUserContext();
  const { raters } = useRecipeRatersQuery(recipeId);

  // Prefer the most recent enthusiastic rater (>=4 stars); fall back to the
  // most recent rater. getRaters returns most-recent-first.
  const rater = useMemo(() => raters.find((r) => r.rating >= 4) ?? raters[0], [raters]);

  if (!rater) return null;

  const displayName = rater.userId === user?.id ? tDetail("you") : (rater.name ?? tDetail("anonymousRater"));

  return (
    <div className="flex items-center gap-2">
      <UserAvatar className="h-8 w-8 text-xs" name={rater.name} userId={rater.userId} />
      <div className="bg-surface-secondary text-default-600 relative rounded-2xl rounded-bl-none px-3 py-1.5 text-xs">
        <span className="mr-1">{t("raterThought", { name: displayName })}</span>
        <span className="inline-flex align-middle">
          <StaticStars rating={rater.rating} />
        </span>
      </div>
    </div>
  );
}

/**
 * DINNER-01: "What's for dinner?" — a single headline suggestion drawn from the
 * viewer's ACCESSIBLE recipes (per-cookbook scoped server-side), weighted by
 * season (from the recipe's own tags) and recent household ratings. "Another
 * idea" cycles through the returned set client-side (no refetch). Renders
 * nothing when there are no candidates (e.g. a fresh, empty library).
 */
export default function DinnerSuggestion() {
  const t = useTranslations("recipes.dinner");
  const router = useRouter();
  const { user } = useUserContext();
  const showRatings = getShowRatingsPreference(user);
  const { suggestions, isLoading } = useDinnerSuggestion(3);
  const [index, setIndex] = useState(0);

  const current = suggestions[index % Math.max(suggestions.length, 1)];

  const cycle = useCallback(() => {
    setIndex((i) => i + 1);
  }, []);

  const open = useCallback(() => {
    if (current) router.push(`/recipes/${current.id}`);
  }, [router, current]);

  if (isLoading || !current) return null;

  const seasonLabel = t(`seasons.${current.season}`);
  const averageRating = current.averageRating;

  return (
    <section aria-labelledby="dinner-suggestion-heading" className="flex shrink-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="dinner-suggestion-heading"
          className="text-foreground flex items-center gap-2 text-2xl leading-8 font-semibold"
        >
          <SparklesIcon className="text-accent h-6 w-6" />
          {t("title")}
        </h2>
        {suggestions.length > 1 && (
          <Button size="sm" startContent={<ArrowPathIcon className="h-4 w-4" />} variant="ghost" onPress={cycle}>
            {t("anotherIdea")}
          </Button>
        )}
      </div>

      <Card
        className="border-border bg-surface shadow-surface relative w-full cursor-pointer overflow-hidden rounded-3xl border p-0"
        variant="default"
      >
        <button
          aria-label={t("openRecipe", { name: current.name })}
          className="flex w-full items-stretch gap-0 text-left focus-visible:outline-none"
          type="button"
          onClick={open}
        >
          <div className="bg-surface-secondary relative h-32 w-32 shrink-0 overflow-hidden sm:h-36 sm:w-36">
            {current.image ? (
              <img alt={current.name} className="h-full w-full object-cover" src={current.image} />
            ) : (
              <div className="text-muted flex h-full w-full items-center justify-center">
                <PhotoIcon className="h-10 w-10 opacity-70" />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {current.matchesSeason && (
                <Chip className="shrink-0 rounded-full px-2 text-[11px]" size="sm" variant="soft">
                  <Chip.Label>{t("seasonalPick", { season: seasonLabel })}</Chip.Label>
                </Chip>
              )}
              {showRatings && typeof averageRating === "number" && averageRating > 0 && (
                <Chip className="shrink-0 rounded-full px-2 text-[11px]" size="sm" variant="soft">
                  <StarSolid className="text-warning h-3.5 w-3.5" />
                  <Chip.Label>{averageRating.toFixed(1)}</Chip.Label>
                </Chip>
              )}
            </div>

            <h3 className="text-foreground truncate text-lg font-semibold" title={current.name}>
              {current.name}
            </h3>

            {showRatings && <RaterThoughtBubble recipeId={current.id} />}
          </div>
        </button>
      </Card>
    </section>
  );
}
