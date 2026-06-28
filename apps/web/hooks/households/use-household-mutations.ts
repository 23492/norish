"use client";

import { useTRPC } from "@/app/providers/trpc-provider";

import {
  createUseHouseholdMutations,
  createUseHouseholdQuery,
  createUseHouseholdsListQuery,
} from "@norish/shared-react/hooks/households";

import { useCurrentHouseholdUserName } from "./adapters";

const useHouseholdQuery = createUseHouseholdQuery({ useTRPC });
const useHouseholdsListQuery = createUseHouseholdsListQuery({ useTRPC });
const useSharedHouseholdMutations = createUseHouseholdMutations({
  useTRPC,
  useHouseholdQuery,
  useHouseholdsListQuery,
  useCurrentUserName: useCurrentHouseholdUserName,
});

export const useHouseholdMutations = useSharedHouseholdMutations;

export type { HouseholdMutationsResult } from "@norish/shared-react/hooks";
