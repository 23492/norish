import type { QueryKey } from "@tanstack/react-query";
import type { createTRPCContext } from "@trpc/tanstack-react-query";
import type {
  HouseholdAdminSettingsDto,
  HouseholdSettingsDto,
  HouseholdSummaryDto,
} from "@norish/shared/contracts/dto/household";
import type { AppRouter } from "@norish/trpc/client";

type TrpcContext = ReturnType<typeof createTRPCContext<AppRouter>>;
export type TrpcHookBinding = ReturnType<TrpcContext["useTRPC"]>;

export type HouseholdData = {
  household: HouseholdSettingsDto | HouseholdAdminSettingsDto | null;
  currentUserId: string;
};

export type HouseholdQueryResult = {
  household: HouseholdSettingsDto | HouseholdAdminSettingsDto | null;
  currentUserId: string | undefined;
  error: unknown;
  isLoading: boolean;
  queryKey: QueryKey;
  setHouseholdData: (
    updater: (prev: HouseholdData | undefined) => HouseholdData | undefined
  ) => void;
  invalidate: () => void;
};

export type HouseholdsListResult = {
  households: HouseholdSummaryDto[];
  activeHouseholdId: string | null;
  currentUserId: string | undefined;
  isLoading: boolean;
  queryKey: QueryKey;
  invalidate: () => void;
};

export type HouseholdCacheHelpers = {
  setHouseholdData: (
    updater: (prev: HouseholdData | undefined) => HouseholdData | undefined
  ) => void;
  invalidate: () => void;
  invalidateCalendar: () => void;
};

export type HouseholdMutationsResult = {
  createHousehold: (name: string) => void;
  joinHousehold: (code: string) => void;
  leaveHousehold: (householdId: string) => void;
  kickUser: (householdId: string, userId: string) => void;
  regenerateJoinCode: (householdId: string) => void;
  transferAdmin: (householdId: string, newAdminId: string) => void;
  switchActive: (householdId: string | null) => void;
};

export interface CreateHouseholdHooksOptions {
  useTRPC: () => TrpcHookBinding;
}
