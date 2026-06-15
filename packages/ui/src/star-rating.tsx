"use client";

import { useState } from "react";
import { StarIcon as StarOutline, XMarkIcon } from "@heroicons/react/24/outline";
import { StarIcon as StarSolid } from "@heroicons/react/24/solid";

interface StarRatingProps {
  value: number | null;
  onChange: (rating: number) => void;
  isLoading?: boolean;
  userValue?: number | null;
  onClear?: () => void;
  clearLabel?: string;
}

export default function StarRating({
  value,
  onChange,
  isLoading = false,
  userValue = null,
  onClear,
  clearLabel = "Clear rating",
}: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null);
  const displayValue = hoverValue ?? value ?? 0;
  const canClear = Boolean(onClear) && userValue != null;

  const handleStarClick = (starValue: number) => {
    // Clicking the star you already gave clears it — quick undo for an accidental tap.
    if (onClear && userValue === starValue) {
      onClear();

      return;
    }

    onChange(starValue);
  };

  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHoverValue(null)}>
      {[1, 2, 3, 4, 5].map((starValue) => {
        const isFilled = displayValue >= starValue;

        return (
          <button
            key={starValue}
            aria-label={`Rate ${starValue} out of 5`}
            className="cursor-pointer transition-transform hover:scale-110 disabled:cursor-default disabled:opacity-50"
            disabled={isLoading}
            type="button"
            onClick={() => handleStarClick(starValue)}
            onMouseEnter={() => setHoverValue(starValue)}
          >
            {isFilled ? (
              <StarSolid className="text-warning h-8 w-8" />
            ) : (
              <StarOutline className="text-default-300 h-8 w-8" />
            )}
          </button>
        );
      })}
      {canClear && (
        <button
          aria-label={clearLabel}
          className="text-default-400 hover:text-danger ml-1 cursor-pointer transition-colors disabled:cursor-default disabled:opacity-50"
          disabled={isLoading}
          title={clearLabel}
          type="button"
          onClick={onClear}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
