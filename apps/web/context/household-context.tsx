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
  useCreateHousehold: () => useHouseholdMutations().createHousehold,
  useJoinHousehold: () => useHouseholdMutations().joinHousehold,
  useRename: () => useHouseholdMutations().rename,
  useGenerateInviteToken: () => useHouseholdMutations().generateInviteToken,
  useJoinByInviteToken: () => useHouseholdMutations().joinByInviteToken,
  useHouseholdSubscription,
});

export { HouseholdProvider, useHouseholdContext };
