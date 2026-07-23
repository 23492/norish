"use client";

import { memo } from "react";
import { Card, Skeleton, Spinner } from "@heroui/react";
import { useTranslations } from "next-intl";

import type { RecipeImportStage } from "@norish/shared/contracts";

type RecipeCardSkeletonProps = {
  variant?: "grid" | "list";
  // IMPORT-UX-01: when a running import has emitted an honest stage over the
  // (cookbook-scoped) realtime bus, show it in place of the bare skeleton.
  stage?: RecipeImportStage;
};

function ImportStageBadge({ stage }: { stage: RecipeImportStage }) {
  const t = useTranslations("common.import.progress");

  return (
    <div className="bg-surface/85 text-foreground absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 px-3 py-2 text-xs font-medium backdrop-blur-sm">
      <Spinner color="accent" size="sm" />
      <span>{t(stage)}</span>
    </div>
  );
}

function RecipeCardSkeletonComponent({ variant = "grid", stage }: RecipeCardSkeletonProps) {
  if (variant === "list") {
    return (
      <Card data-recipe-card className="h-[128px] w-full gap-0 overflow-hidden rounded-2xl p-0">
        <div className="relative flex h-full min-w-0 items-stretch">
          <Skeleton className="h-full w-[112px] shrink-0 rounded-none" />
          <Card.Content className="min-w-0 flex-1 px-4 py-3">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="mt-3 h-3 w-full rounded" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-14 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          </Card.Content>
          {stage ? <ImportStageBadge stage={stage} /> : null}
        </div>
      </Card>
    );
  }

  return (
    <Card data-recipe-card className="h-[340px] w-full gap-0 overflow-hidden rounded-3xl p-0">
      <div className="relative h-[236px] w-full overflow-hidden">
        <Skeleton className="absolute inset-0 h-full w-full" />
        {stage ? <ImportStageBadge stage={stage} /> : null}
      </div>
      <Card.Content className="h-[104px] px-4 pt-3 pb-3">
        <Skeleton className="h-4 w-3/4 rounded" />
        <div className="mt-2 space-y-2">
          <Skeleton className="h-3 w-full rounded" />
          <Skeleton className="h-3 w-5/6 rounded" />
        </div>
      </Card.Content>
    </Card>
  );
}

// Memoized: re-renders only when variant or the import stage changes.
const RecipeCardSkeleton = memo(RecipeCardSkeletonComponent);

RecipeCardSkeleton.displayName = "RecipeCardSkeleton";

export default RecipeCardSkeleton;
