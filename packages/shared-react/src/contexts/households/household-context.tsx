
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
};

type CreateHouseholdContextOptions = {
  useHouseholdQuery: () => Pick<HouseholdQueryResult, "household" | "currentUserId" | "isLoading">;
  useHouseholdsListQuery: () => Pick<
    HouseholdsListResult,
    "households" | "activeHouseholdId"
  >;
  useSwitchActive: () => HouseholdMutationsResult["switchActive"];
  useHouseholdSubscription: () => void;
};

export function createHouseholdContext({
  useHouseholdQuery,
  useHouseholdsListQuery,
  useSwitchActive,
  useHouseholdSubscription,
}: CreateHouseholdContextOptions) {
  const HouseholdContext = createContext<HouseholdContextValue | null>(null);

  function HouseholdProvider({ children }: { children: React.ReactNode }) {
    const { household, currentUserId, isLoading } = useHouseholdQuery();
    const { households, activeHouseholdId } = useHouseholdsListQuery();
    const switchActive = useSwitchActive();

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
      }),
      [household, currentUserId, isLoading, households, activeHouseholdId, switchActive]
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

export type HouseholdSettingsContextValue = HouseholdContextValue & {
  createHousehold: (name: string) => void;
  joinHousehold: (code: string) => void;
  leaveHousehold: (householdId: string) => void;
  kickUser: (householdId: string, userId: string) => void;
  regenerateJoinCode: (householdId: string) => void;
  transferAdmin: (householdId: string, newAdminId: string) => void;
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
    const {
      createHousehold,
      joinHousehold,
      leaveHousehold,
      kickUser,
      regenerateJoinCode,
      transferAdmin,
    } = useHouseholdMutations();

    const value = useMemo<HouseholdSettingsContextValue>(
      () => ({
        ...base,
        createHousehold,
        joinHousehold,
        leaveHousehold,
        kickUser,
        regenerateJoinCode,
        transferAdmin,
      }),
      [
        base,
        createHousehold,
        joinHousehold,
        leaveHousehold,
        kickUser,
        regenerateJoinCode,
        transferAdmin,
      ]
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
