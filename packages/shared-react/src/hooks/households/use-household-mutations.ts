import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { HouseholdSettingsDto } from "@norish/shared/contracts/dto/household";
import type { PermissionLevel } from "@norish/config/zod/server-config";

import type {
  CreateHouseholdHooksOptions,
  HouseholdMutationsResult,
  HouseholdQueryResult,
  HouseholdsListResult,
} from "./types";

type CreateUseHouseholdMutationsOptions = CreateHouseholdHooksOptions & {
  useHouseholdQuery: () => HouseholdQueryResult;
  useHouseholdsListQuery: () => HouseholdsListResult;
  useCurrentUserName: () => string | null;
};

export function createUseHouseholdMutations({
  useTRPC,
  useHouseholdQuery,
  useHouseholdsListQuery,
  useCurrentUserName,
}: CreateUseHouseholdMutationsOptions) {
  return function useHouseholdMutations(): HouseholdMutationsResult {
    const trpc = useTRPC();
    const queryClient = useQueryClient();
    const { household, setHouseholdData, invalidate, currentUserId } = useHouseholdQuery();
    const { invalidate: invalidateHouseholdsList } = useHouseholdsListQuery();
    const userName = useCurrentUserName();

    // Recipe-list cache lives under the tRPC recipes.list path; switching the
    // active cookbook must refetch it so the dashboard shows the new cookbook.
    const recipesListPath = [trpc.recipes.list.queryKey({})[0]];

    const getHouseholdVersion = (householdId: string): number =>
      household?.id === householdId ? household.version : 1;

    const createMutation = useMutation(trpc.households.create.mutationOptions());
    const joinMutation = useMutation(trpc.households.join.mutationOptions());
    const leaveMutation = useMutation(trpc.households.leave.mutationOptions());
    const kickMutation = useMutation(trpc.households.kick.mutationOptions());
    const regenerateCodeMutation = useMutation(trpc.households.regenerateCode.mutationOptions());
    const transferAdminMutation = useMutation(trpc.households.transferAdmin.mutationOptions());
    const renameMutation = useMutation(trpc.households.rename.mutationOptions());
    const setPolicyMutation = useMutation(trpc.households.setPolicy.mutationOptions());
    const switchActiveMutation = useMutation(trpc.households.switchActive.mutationOptions());
    const generateInviteTokenMutation = useMutation(
      trpc.households.generateInviteToken.mutationOptions()
    );
    const joinByInviteTokenMutation = useMutation(
      trpc.households.joinByInviteToken.mutationOptions()
    );

    const createHousehold = (name: string): void => {
      if (!name.trim()) {
        throw new Error("Household name cannot be empty");
      }

      if (!currentUserId) {
        throw new Error("User ID not available");
      }

      createMutation.mutate(
        { name: name.trim() },
        {
          onSuccess: ({ id }) => {
            // Optimistically add the household
            const optimisticHousehold: HouseholdSettingsDto = {
              id,
              name: name.trim(),
              version: 1,
              users: [
                {
                  id: currentUserId,
                  name: userName,
                  isAdmin: true,
                  version: 1,
                },
              ],
              allergies: [],
            };

            setHouseholdData((prev) => ({
              household: optimisticHousehold,
              currentUserId: prev?.currentUserId ?? currentUserId,
            }));
          },
          onError: () => invalidate(),
        }
      );
    };

    const joinHousehold = (code: string): void => {
      if (!code.trim()) {
        throw new Error("Join code cannot be empty");
      }

      if (!currentUserId) {
        throw new Error("User ID not available");
      }

      joinMutation.mutate(
        { code: code.trim() },
        {
          // Optimistic update will come from the subscription (onCreated)
          onError: () => invalidate(),
        }
      );
    };

    const leaveHousehold = (householdId: string): void => {
      const currentMembershipVersion =
        household?.id === householdId
          ? (household.users.find((user) => user.id === currentUserId)?.version ?? 1)
          : 1;

      leaveMutation.mutate(
        { householdId, version: currentMembershipVersion },
        {
          onSuccess: () => {
            // Clear household from cache
            setHouseholdData((prev) => ({
              household: null,
              currentUserId: prev?.currentUserId ?? currentUserId ?? "",
            }));
          },
          onError: () => invalidate(),
        }
      );
    };

    const kickUser = (householdId: string, userId: string): void => {
      const memberVersion =
        household?.id === householdId
          ? (household.users.find((user) => user.id === userId)?.version ?? 1)
          : 1;

      kickMutation.mutate(
        { householdId, userId, version: memberVersion },
        {
          onSuccess: () => {
            // Optimistically remove the user from the list
            setHouseholdData((prev) => {
              if (!prev?.household) return prev;

              return {
                ...prev,
                household: {
                  ...prev.household,
                  users: prev.household.users.filter((u) => u.id !== userId),
                },
              };
            });
          },
          onError: () => invalidate(),
        }
      );
    };

    const regenerateJoinCode = (householdId: string): void => {
      regenerateCodeMutation.mutate(
        { householdId, version: getHouseholdVersion(householdId) },
        {
          // The new join code will come from the subscription
          onError: () => invalidate(),
        }
      );
    };

    const transferAdmin = (householdId: string, newAdminId: string): void => {
      transferAdminMutation.mutate(
        { householdId, newAdminId, version: getHouseholdVersion(householdId) },
        {
          onSuccess: () => {
            // Optimistically update admin status
            setHouseholdData((prev) => {
              if (!prev?.household) return prev;

              // After transferring admin, current user is no longer admin
              // So we need to update the household to non-admin view
              const updatedHousehold: HouseholdSettingsDto = {
                id: prev.household.id,
                name: prev.household.name,
                version: prev.household.version,
                users: prev.household.users.map((u) => ({
                  ...u,
                  isAdmin: u.id === newAdminId,
                })),
                allergies: prev.household.allergies,
              };

              return {
                ...prev,
                household: updatedHousehold,
              };
            });
          },
          onError: () => invalidate(),
        }
      );
    };

    const rename = (householdId: string, name: string, version: number): void => {
      const trimmedName = name.trim();

      if (!trimmedName) {
        throw new Error("Household name cannot be empty");
      }

      renameMutation.mutate(
        { householdId, name: trimmedName, version },
        {
          onSuccess: () => {
            // Optimistically reflect the new name in the active-household view...
            setHouseholdData((prev) => {
              if (!prev?.household || prev.household.id !== householdId) return prev;

              return {
                ...prev,
                household: { ...prev.household, name: trimmedName },
              };
            });
            // ...and refresh the switcher list so its label updates too.
            invalidateHouseholdsList();
          },
          onError: () => invalidate(),
        }
      );
    };

    const setPolicy = (
      householdId: string,
      policy: { view: "household" | "owner"; edit: PermissionLevel; delete: PermissionLevel },
      version: number
    ): void => {
      setPolicyMutation.mutate(
        { householdId, view: policy.view, edit: policy.edit, delete: policy.delete, version },
        {
          onSuccess: () => {
            // Optimistically reflect the new policy in the admin settings view
            // (the admin DTO carries viewPolicy/editPolicy/deletePolicy; the
            // member DTO does not, so only update when those fields are present).
            setHouseholdData((prev) => {
              if (!prev?.household || prev.household.id !== householdId) return prev;

              if (!("viewPolicy" in prev.household)) return prev;

              return {
                ...prev,
                household: {
                  ...prev.household,
                  viewPolicy: policy.view,
                  editPolicy: policy.edit,
                  deletePolicy: policy.delete,
                },
              };
            });
          },
          onError: () => invalidate(),
        }
      );
    };

    const switchActive = (householdId: string | null): void => {
      switchActiveMutation.mutate(
        { householdId },
        {
          onSuccess: () => {
            // Reflect the new active cookbook in the switcher list...
            invalidateHouseholdsList();
            // ...the active-household settings view...
            invalidate();
            // ...and refetch the recipe list so the dashboard shows this cookbook.
            queryClient.invalidateQueries({ queryKey: recipesListPath });
          },
          onError: () => {
            invalidateHouseholdsList();
            invalidate();
          },
        }
      );
    };

    // Generate (or regenerate) the shareable invite link token. Resolves to the
    // new token; the router invalidates the admin's household cache, and we also
    // invalidate the active-household query so the settings card refetches the
    // new inviteToken into view.
    const generateInviteToken = async (householdId: string): Promise<string> => {
      const { inviteToken } = await generateInviteTokenMutation.mutateAsync({ householdId });

      invalidate();

      return inviteToken;
    };

    // Join a cookbook via its invite token. The backend adds the membership +
    // makes it active; resolves to the joined household id. Refresh the switcher
    // list, the active-household view, and the recipe list (new active cookbook).
    const joinByInviteToken = async (token: string): Promise<string> => {
      const { householdId } = await joinByInviteTokenMutation.mutateAsync({ token });

      invalidateHouseholdsList();
      invalidate();
      queryClient.invalidateQueries({ queryKey: recipesListPath });

      return householdId;
    };

    return {
      createHousehold,
      joinHousehold,
      leaveHousehold,
      kickUser,
      regenerateJoinCode,
      transferAdmin,
      rename,
      setPolicy,
      switchActive,
      generateInviteToken,
      joinByInviteToken,
    };
  };
}
