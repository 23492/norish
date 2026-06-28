"use client";

import { use, useEffect } from "react";
import AuthLanguageSelector from "@/components/shared/auth-language-selector";
import { NotFoundView } from "@/components/shared/not-found-view";
import RecipeSkeleton from "@/components/skeleton/recipe-skeleton";
import { TimerTicker } from "@/components/timer-dock";
import { sharedRecipeShareHooks } from "@/hooks/recipes/shared-recipe-hooks";
import { TRPCClientError } from "@trpc/client";
import { useTranslations } from "next-intl";

import { SharedRecipePageDesktop } from "./components/shared-recipe-page-desktop";
import { SharedRecipePageMobile } from "./components/shared-recipe-page-mobile";
import { PublicRecipeProvider } from "./public/public-recipe-context";

type Props = {
  params: Promise<{
    token: string;
  }>;
};

function SharedRecipePageContent({ token }: { token: string }) {
  const { recipe, isLoading, error } = sharedRecipeShareHooks.useSharedRecipeQuery(token);
  const t = useTranslations("recipes.detail");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  if (isLoading) {
    return <RecipeSkeleton />;
  }
  // Visibility gate: the server (sharedRecipeProcedure) returns NOT_FOUND for
  // recipes whose visibility does not permit anonymous access (private / household).
  // The UI reflects that gate — no recipe data is ever returned for non-public recipes.
  if (!recipe || (error instanceof TRPCClientError && error.data?.code === "NOT_FOUND")) {
    return <NotFoundView message={t("notFoundMessage")} title={t("notFound")} />;
  }

  return (
    <PublicRecipeProvider recipe={recipe} token={token}>
      <TimerTicker />
      <div className="hidden justify-end pt-4 md:flex md:px-6">
        <AuthLanguageSelector />
      </div>
      <SharedRecipePageDesktop />
      <SharedRecipePageMobile />
    </PublicRecipeProvider>
  );
}
export default function SharedRecipePage({ params }: Props) {
  const { token } = use(params);

  return <SharedRecipePageContent token={token} />;
}
