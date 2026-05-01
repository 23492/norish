import type { ReactNode } from "react";
import { createContext, createElement, useContext, useMemo } from "react";

import type {
  GroceriesCacheHelpers,
  GroceriesMutationsResult,
  GroceriesQueryResult,
} from "../../hooks/groceries";

export type GroceriesDataContextValue = {
  query: GroceriesQueryResult;
  mutations: GroceriesMutationsResult;
  cache: GroceriesCacheHelpers;
};

type CreateGroceriesContextOptions<TUiState> = {
  useGroceriesQuery: () => GroceriesQueryResult;
  useGroceriesMutations: () => GroceriesMutationsResult;
  useGroceriesCacheHelpers: () => GroceriesCacheHelpers;
  useGroceriesSubscription: () => void;
  useGroceriesUiState: () => TUiState;
};

export function createGroceriesContext<TUiState>({
  useGroceriesQuery,
  useGroceriesMutations,
  useGroceriesCacheHelpers,
  useGroceriesSubscription,
  useGroceriesUiState,
}: CreateGroceriesContextOptions<TUiState>) {
  const GroceriesDataContext = createContext<GroceriesDataContextValue | null>(null);
  const GroceriesUiContext = createContext<TUiState | null>(null);

  function GroceriesProvider({ children }: { children: ReactNode }) {
    const query = useGroceriesQuery();
    const mutations = useGroceriesMutations();
    const cache = useGroceriesCacheHelpers();
    const ui = useGroceriesUiState();

    useGroceriesSubscription();

    const dataValue = useMemo<GroceriesDataContextValue>(
      () => ({ query, mutations, cache }),
      [cache, mutations, query]
    );

    return createElement(
      GroceriesDataContext.Provider,
      { value: dataValue },
      createElement(GroceriesUiContext.Provider, { value: ui }, children)
    );
  }

  function useGroceriesDataContext() {
    const context = useContext(GroceriesDataContext);

    if (!context) {
      throw new Error("useGroceriesDataContext must be used within GroceriesProvider");
    }

    return context;
  }

  function useGroceriesUiContext() {
    const context = useContext(GroceriesUiContext);

    if (!context) {
      throw new Error("useGroceriesUiContext must be used within GroceriesProvider");
    }

    return context;
  }

  return {
    GroceriesProvider,
    useGroceriesDataContext,
    useGroceriesUiContext,
  };
}
