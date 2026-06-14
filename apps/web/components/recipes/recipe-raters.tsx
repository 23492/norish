"use client";

import { StarIcon as StarOutline } from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";
import { useTranslations } from "next-intl";

import { useUserContext } from "@/context/user-context";
import { useRecipeRatersQuery } from "@/hooks/ratings";

interface RecipeRatersProps {
  recipeId: string;
}

/** Read-only 5-star row for a single rater's score. */
function StaticStars({ rating }: { rating: number }) {
  return (
    <div aria-hidden className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) =>
        star <= rating ? (
          <StarSolid key={star} className="text-warning h-4 w-4" />
        ) : (
          <StarOutline key={star} className="text-default-300 h-4 w-4" />
        )
      )}
    </div>
  );
}

/**
 * RATE-01: the recipe's aggregate (average + count) and the per-user
 * "rated by <name> ★★★★" list, for an AUTHENTICATED viewer. Data comes from the
 * access-gated ratings.getRaters query (a user who cannot view the recipe gets
 * FORBIDDEN -> no data -> this renders nothing). Names are the users' display
 * names; a missing name falls back to a generic label, and the current user is
 * labelled "You". Showing rater names on the public /share view is deferred
 * (RATE-02, a privacy decision).
 */
export default function RecipeRaters({ recipeId }: RecipeRatersProps) {
  const t = useTranslations("recipes.detail");
  const { user } = useUserContext();
  const { averageRating, ratingCount, raters, isLoading } = useRecipeRatersQuery(recipeId);

  if (isLoading || ratingCount === 0) {
    return null;
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      {/* Aggregate: average + count */}
      <div className="flex items-center justify-center gap-2">
        <StarSolid className="text-warning h-5 w-5" />
        <span className="text-default-700 font-semibold">
          {averageRating !== null ? averageRating.toFixed(1) : "—"}
        </span>
        <span className="text-default-500 text-sm">{t("ratingsCount", { count: ratingCount })}</span>
      </div>

      {/* Per-user rated-by list */}
      <ul className="flex flex-col gap-1.5">
        {raters.map((rater) => {
          const displayName =
            rater.userId === user?.id ? t("you") : (rater.name ?? t("anonymousRater"));

          return (
            <li key={rater.userId} className="flex items-center justify-between gap-3">
              <span className="text-default-600 truncate text-sm">
                {t("ratedBy", { name: displayName })}
              </span>
              <StaticStars rating={rater.rating} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
