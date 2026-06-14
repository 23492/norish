"use client";

import { useRouter } from "next/navigation";
import { BookmarkIcon } from "@heroicons/react/16/solid";
import { addToast, Button } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "@norish/shared/lib/auth/client";

import { useTRPC } from "@/app/providers/trpc-provider";

type Props = {
  token: string;
  recipeName: string;
};

/**
 * SHARE-02 "Save to my cookbook" on a public /share/<token> recipe.
 *
 * - Logged OUT: send to the existing login/signup flow with a return URL back
 *   to this share page (no registration bypass — `registration_enabled` still
 *   applies); after auth the visitor lands here again and can save.
 * - Logged IN: copy the shared recipe into the saver's ACTIVE cookbook as a new
 *   recipe they own (server-side `recipes.saveShared`, gated on the same public
 *   share token), then navigate to the new owned recipe.
 */
export function ShareSaveButton({ token, recipeName }: Props) {
  const t = useTranslations("recipes.sharePage.save");
  const router = useRouter();
  const trpc = useTRPC();
  const { data: session } = useSession();

  const saveMutation = useMutation(
    trpc.recipes.saveShared.mutationOptions({
      onSuccess: ({ recipeId }) => {
        addToast({
          title: t("success"),
          description: t("successDescription", { recipeName }),
          color: "success",
          shouldShowTimeoutProgress: true,
        });
        // Land on the saver's own copy.
        router.push(`/recipes/${recipeId}`);
      },
      onError: () => {
        addToast({ title: t("error"), description: t("errorDescription"), color: "danger" });
      },
    })
  );

  const handleSave = () => {
    if (!session?.user) {
      // Existing login/signup flow; return to this share page afterwards.
      router.push(`/login?callbackUrl=${encodeURIComponent(`/share/${token}`)}`);

      return;
    }

    saveMutation.mutate({ token });
  };

  return (
    <Button
      color="primary"
      isLoading={saveMutation.isPending}
      size="sm"
      startContent={!saveMutation.isPending ? <BookmarkIcon className="h-4 w-4" /> : undefined}
      variant="flat"
      onPress={handleSave}
    >
      {t("button")}
    </Button>
  );
}
