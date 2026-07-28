"use client";

import { memo, useCallback } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { Button, Card } from "@heroui/react";
import { useTranslations } from "next-intl";

type FailedImportCardProps = {
  recipeId: string;
  reason: string;
  url?: string;
  variant?: "grid" | "list";
  onDismiss: (recipeId: string) => void;
};

/** The host of a failed import's source URL, or null for an unparsable/missing url. */
function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null;

  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function FailedImportCardComponent({
  recipeId,
  reason,
  url,
  variant = "grid",
  onDismiss,
}: FailedImportCardProps) {
  const t = useTranslations("common.import.failure");
  const host = hostFromUrl(url);
  const description = reason.trim() || t("fallbackReason");

  const handleDismiss = useCallback(() => {
    onDismiss(recipeId);
  }, [onDismiss, recipeId]);

  const dismissButton = (
    <Button
      isIconOnly
      aria-label={t("dismiss")}
      className="text-danger hover:bg-danger/10 h-8 w-8 min-w-0 shrink-0 rounded-full p-0"
      size="sm"
      type="button"
      variant="ghost"
      onPress={handleDismiss}
    >
      <XMarkIcon className="h-5 w-5" />
    </Button>
  );

  if (variant === "list") {
    return (
      <Card
        data-recipe-card
        className="border-danger/40 bg-danger/5 h-[128px] w-full gap-0 overflow-hidden rounded-2xl border p-0"
      >
        <div className="flex h-full min-w-0 items-stretch">
          <div className="bg-danger/10 flex h-full w-[112px] shrink-0 items-center justify-center">
            <ExclamationTriangleIcon aria-hidden="true" className="text-danger h-8 w-8" />
          </div>
          <Card.Content className="flex min-w-0 flex-1 items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-danger truncate text-base leading-5 font-semibold">
                {t("title")}
              </h3>
              <p className="text-muted mt-1 truncate text-sm" title={description}>
                {description}
              </p>
              {host && (
                <p className="text-muted mt-1 truncate text-xs">{t("source", { host })}</p>
              )}
            </div>
            {dismissButton}
          </Card.Content>
        </div>
      </Card>
    );
  }

  return (
    <Card
      data-recipe-card
      className="border-danger/40 bg-danger/5 h-[340px] w-full gap-0 overflow-hidden rounded-3xl border p-0"
    >
      <div className="bg-danger/10 relative flex h-[236px] w-full items-center justify-center overflow-hidden">
        <ExclamationTriangleIcon aria-hidden="true" className="text-danger h-12 w-12" />
        <div className="absolute top-2 right-2">{dismissButton}</div>
      </div>
      <Card.Content className="h-[104px] px-4 pt-3 pb-3">
        <h3 className="text-danger truncate text-base font-semibold">{t("title")}</h3>
        <p className="text-muted mt-1 text-sm" title={description}>
          {description}
        </p>
        {host && <p className="text-muted mt-1 truncate text-xs">{t("source", { host })}</p>}
      </Card.Content>
    </Card>
  );
}

// Memoized: re-renders only when the failure's identifying fields or variant change.
const FailedImportCard = memo(FailedImportCardComponent);

FailedImportCard.displayName = "FailedImportCard";

export default FailedImportCard;
