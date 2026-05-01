import { useMemo, useState } from "react";
import {
  useGroceriesCacheHelpers,
  useGroceriesMutations,
  useGroceriesQuery,
  useGroceriesSubscription,
} from "@/hooks/groceries";

import { createGroceriesContext } from "@norish/shared-react/contexts";

export type GroceryViewMode = "store" | "recipe";

type MobileGroceriesUiContextValue = {
  viewMode: GroceryViewMode;
  setViewMode: (viewMode: GroceryViewMode) => void;
};

function useMobileGroceriesUiState() {
  const [viewMode, setViewMode] = useState<GroceryViewMode>("store");

  return useMemo<MobileGroceriesUiContextValue>(() => ({ viewMode, setViewMode }), [viewMode]);
}

const sharedGroceriesContext = createGroceriesContext({
  useGroceriesQuery,
  useGroceriesMutations,
  useGroceriesCacheHelpers,
  useGroceriesSubscription,
  useGroceriesUiState: useMobileGroceriesUiState,
});

export const GroceriesProvider = sharedGroceriesContext.GroceriesProvider;
export const useGroceriesDataContext = sharedGroceriesContext.useGroceriesDataContext;
export const useGroceriesUiContext = sharedGroceriesContext.useGroceriesUiContext;
