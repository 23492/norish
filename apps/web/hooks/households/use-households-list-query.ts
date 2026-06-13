"use client";

import { createUseHouseholdsListQuery } from "@norish/shared-react/hooks/households";

import { useTRPC } from "@/app/providers/trpc-provider";

export const useHouseholdsListQuery = createUseHouseholdsListQuery({ useTRPC });

export type { HouseholdsListResult } from "@norish/shared-react/hooks";
