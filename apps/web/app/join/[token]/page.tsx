"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { UserGroupIcon } from "@heroicons/react/24/outline";
import { Button, Spinner } from "@heroui/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "@norish/shared/lib/auth/client";

import { AuthCard } from "@/app/(auth)/components/auth-card";
import { useTRPC } from "@/app/providers/trpc-provider";

type Props = {
  params: Promise<{ token: string }>;
};

function JoinByTokenContent({ token }: { token: string }) {
  const t = useTranslations("settings.join");
  const router = useRouter();
  const trpc = useTRPC();
  const { data: session, isPending: isSessionLoading } = useSession();
  const [isJoining, setIsJoining] = useState(false);

  // PUBLIC lookup — returns the cookbook NAME only (or null for an invalid token).
  const { data, isLoading, error } = useQuery({
    ...trpc.households.getByInviteToken.queryOptions({ token }),
    enabled: Boolean(token),
    retry: false,
  });

  const joinMutation = useMutation(trpc.households.joinByInviteToken.mutationOptions());

  const handleJoin = async () => {
    // Logged-out visitors go through the existing login/signup flow and return
    // here afterwards (no registration bypass — registration_enabled still applies).
    if (!session?.user) {
      router.push(`/login?callbackUrl=${encodeURIComponent(`/join/${token}`)}`);

      return;
    }

    setIsJoining(true);
    try {
      await joinMutation.mutateAsync({ token });
      // Joined + the cookbook is now active; land on the dashboard.
      router.push("/");
    } catch {
      setIsJoining(false);
    }
  };

  if (isLoading || isSessionLoading) {
    return (
      <AuthCard subtitle={t("loading")} title={t("title")}>
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      </AuthCard>
    );
  }

  // Invalid / revoked token — a friendly state, never a raw error or data leak.
  if (error || !data) {
    return (
      <AuthCard subtitle={t("invalidDescription")} title={t("invalidTitle")}>
        <div className="flex justify-center">
          <Button as="a" color="primary" href="/" variant="flat">
            {t("goHome")}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard subtitle={session?.user ? t("subtitle") : t("loginPrompt")} title={data.name}>
      <div className="flex flex-col gap-4">
        <p className="text-default-600 flex items-center justify-center gap-2 text-center text-base">
          <UserGroupIcon className="h-5 w-5" />
          {t("description", { name: data.name })}
        </p>
        <Button
          color="primary"
          isLoading={isJoining || joinMutation.isPending}
          onPress={handleJoin}
        >
          {t("joinButton")}
        </Button>
      </div>
    </AuthCard>
  );
}

export default function JoinByTokenPage({ params }: Props) {
  const { token } = use(params);

  return <JoinByTokenContent token={token} />;
}
