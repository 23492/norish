"use client";

import { createHouseholdContext } from "@norish/shared-react/contexts";

import {
  useHouseholdMutations,
  useHouseholdQuery,
  useHouseholdsListQuery,
  useHouseholdSubscription,
} from "@/hooks/households";


export type { HouseholdContextValue } from "@norish/shared-react/contexts";

const { HouseholdProvider, useHouseholdContext } = createHouseholdContext({
  useHouseholdQuery,
  useHouseholdsListQuery,
  useSwitchActive: () => useHouseholdMutations().switchActive,
  useHouseholdSubscription,
});

export { HouseholdProvider, useHouseholdContext };
