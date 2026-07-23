"use client";

import type { DinnerSuggestion, DinnerSuggestionResult } from "@norish/shared-react/hooks";

import { sharedDashboardRecipeHooks } from "./shared-recipe-hooks";

export type { DinnerSuggestion, DinnerSuggestionResult };

export const useDinnerSuggestion = sharedDashboardRecipeHooks.useDinnerSuggestion;
