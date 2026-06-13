
import type {
  HouseholdAdminSettingsDto,
  HouseholdSettingsDto,
  HouseholdSummaryDto,
} from "@norish/shared/contracts/dto/household";
import type {
  HouseholdQueryResult,
  HouseholdsListResult,
  HouseholdMutationsResult,
} from "../../hooks/households/types";

import { createContext, useContext, useMemo } from "react";

export type HouseholdContextValue = {
  household: HouseholdSettingsDto | HouseholdAdminSettingsDto | null;
  currentUserId: string | undefined;
  isLoading: boolean;
  households: HouseholdSummaryDto[];
  activeHouseholdId: string | null;
  switchActive: (householdId: string | null) => void;
  createHousehold: (name: string) => void;
  joinHousehold: (code: string) => void;
  rename: (householdId: string, name: string, version: number) => void;
  generateInviteToken: (householdId: string) => Promise<string>;
  joinByInviteToken: (token: string) => Promise<string>;
};

type CreateHouseholdContextOptions = {
  useHouseholdQuery: () => Pick<HouseholdQueryResult, "household" | "currentUserId" | "isLoading">;
  useHouseholdsListQuery: () => Pick<
    HouseholdsListResult,
    "households" | "activeHouseholdId"
  >;
  useSwitchActive: () => HouseholdMutationsResult["switchActive"];
  useCreateHousehold: () => HouseholdMutationsResult["createHousehold"];
  useJoinHousehold: () => HouseholdMutationsResult["joinHousehold"];
  useRename: () => HouseholdMutationsResult["rename"];
  useGenerateInviteToken: () => HouseholdMutationsResult["generateInviteToken"];
  useJoinByInviteToken: () => HouseholdMutationsResult["joinByInviteToken"];
  useHouseholdSubscription: () => void;
};

export function createHouseholdContext({
  useHouseholdQuery,
  useHouseholdsListQuery,
  useSwitchActive,
  useCreateHousehold,
  useJoinHousehold,
  useRename,
  useGenerateInviteToken,
  useJoinByInviteToken,
  useHouseholdSubscription,
}: CreateHouseholdContextOptions) {
  const HouseholdContext = createContext<HouseholdContextValue | null>(null);

  function HouseholdProvider({ children }: { children: React.ReactNode }) {
    const { household, currentUserId, isLoading } = useHouseholdQuery();
    const { households, activeHouseholdId } = useHouseholdsListQuery();
    const switchActive = useSwitchActive();
    const createHousehold = useCreateHousehold();
    const joinHousehold = useJoinHousehold();
    const rename = useRename();
    const generateInviteToken = useGenerateInviteToken();
    const joinByInviteToken = useJoinByInviteToken();

    // Subscribe to WebSocket events
    useHouseholdSubscription();

    const value = useMemo(
      () => ({
        household,
        currentUserId,
        isLoading,
        households,
        activeHouseholdId,
        switchActive,
        createHousehold,
        joinHousehold,
        rename,
        generateInviteToken,
        joinByInviteToken,
      }),
      [
        household,
        currentUserId,
        isLoading,
        households,
        activeHouseholdId,
        switchActive,
        createHousehold,
        joinHousehold,
        rename,
        generateInviteToken,
        joinByInviteToken,
      ]
    );

    return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
  }

  function useHouseholdContext(): HouseholdContextValue {
    const context = useContext(HouseholdContext);

    if (!context) {
      throw new Error("useHouseholdContext must be used within HouseholdProvider");
    }

    return context;
  }

  return {
    HouseholdProvider,
    useHouseholdContext,
  };
}

// --- Household Settings Context ---

// createHousehold / joinHousehold / rename are inherited from HouseholdContextValue.
export type HouseholdSettingsContextValue = HouseholdContextValue & {
  leaveHousehold: (householdId: string) => void;
  kickUser: (householdId: string, userId: string) => void;
  regenerateJoinCode: (householdId: string) => void;
  transferAdmin: (householdId: string, newAdminId: string) => void;
  setPolicy: HouseholdMutationsResult["setPolicy"];
};

type CreateHouseholdSettingsContextOptions = {
  useHouseholdContext: () => HouseholdContextValue;
  useHouseholdMutations: () => HouseholdMutationsResult;
};

export function createHouseholdSettingsContext({
  useHouseholdContext,
  useHouseholdMutations,
}: CreateHouseholdSettingsContextOptions) {
  const HouseholdSettingsContext = createContext<HouseholdSettingsContextValue | null>(null);

  function HouseholdSettingsProvider({ children }: { children: React.ReactNode }) {
    const base = useHouseholdContext();
    // createHousehold / joinHousehold / rename come from base (the global context).
    const { leaveHousehold, kickUser, regenerateJoinCode, transferAdmin, setPolicy } =
      useHouseholdMutations();

    const value = useMemo<HouseholdSettingsContextValue>(
      () => ({
        ...base,
        leaveHousehold,
        kickUser,
        regenerateJoinCode,
        transferAdmin,
        setPolicy,
      }),
      [base, leaveHousehold, kickUser, regenerateJoinCode, transferAdmin, setPolicy]
    );

    return (
      <HouseholdSettingsContext.Provider value={value}>
        {children}
      </HouseholdSettingsContext.Provider>
    );
  }

  function useHouseholdSettingsContext(): HouseholdSettingsContextValue {
    const context = useContext(HouseholdSettingsContext);

    if (!context) {
      throw new Error("useHouseholdSettingsContext must be used within HouseholdSettingsProvider");
    }

    return context;
  }

  return {
    HouseholdSettingsProvider,
    useHouseholdSettingsContext,
  };
}
