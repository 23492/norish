import type { GroceryRecurrenceSettings } from "@/components/shell/sheet/grocery-recurrence-sheet";
import type {
  GroceryItem,
  GroceryRowModel,
} from "@/lib/groceries/grocery-view-models";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useGroceriesDataContext, useGroceriesUiContext } from "@/context/groceries-context";
import { GroceryEditorSheet } from "@/components/shell/sheet/grocery-editor-sheet";
import { DEFAULT_GROCERY_RECURRENCE_SETTINGS } from "@/components/shell/sheet/grocery-recurrence-sheet";
import { useStoresQuery, useStoresSubscription } from "@/hooks/stores";
import {
  buildRecipeSections,
  buildStoreSections,
  mapGroceriesToRows,
  mapStoresToGroceryStores,
} from "@/lib/groceries/grocery-view-models";
import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native";

import { GroceriesMenu } from "./groceries-menu";
import { GrocerySectionCard } from "./grocery-section-card";

/** How long to keep a newly-completed item pinned in place before it slides to the bottom. */
const SORT_DELAY_MS = 380;

function buildGroceryInputText(item: GroceryItem) {
  return [item.amount, item.name].filter(Boolean).join(" ");
}

export function GroceriesScreen() {
  const { query: groceriesQuery } = useGroceriesDataContext();
  const { viewMode, setViewMode } = useGroceriesUiContext();
  const [frozenIds, setFrozenIds] = useState<ReadonlySet<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const storesQuery = useStoresQuery();
  const [foregroundColor, mutedColor] = useThemeColor(["foreground", "muted"] as const);

  useStoresSubscription();

  const stores = useMemo(() => mapStoresToGroceryStores(storesQuery.stores), [storesQuery.stores]);
  const items = useMemo(
    () =>
      mapGroceriesToRows({
        groceries: groceriesQuery.groceries,
        recurringGroceries: groceriesQuery.recurringGroceries,
        recipeMap: groceriesQuery.recipeMap,
      }),
    [groceriesQuery.groceries, groceriesQuery.recurringGroceries, groceriesQuery.recipeMap]
  );

  const sections = useMemo(
    () =>
      viewMode === "store"
        ? buildStoreSections({
            items,
            stores,
            recipeMap: groceriesQuery.recipeMap,
            frozenIds,
          })
        : buildRecipeSections({
            items,
            stores,
            recipeMap: groceriesQuery.recipeMap,
            frozenIds,
          }),
    [items, stores, groceriesQuery.recipeMap, viewMode, frozenIds]
  );

  const isLoading = groceriesQuery.isLoading || storesQuery.isLoading;
  const error = groceriesQuery.error ?? storesQuery.error;

  const handleToggleItem = useCallback((id: string) => {
    // Write-flow tasks wire persistence later; keep the animation-only state local for now.
    setFrozenIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setFrozenIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, SORT_DELAY_MS);
  }, []);

  const handlePressItem = useCallback((item: GroceryRowModel) => {
    setEditingItemId(item.id);
  }, []);

  const handleDeleteItem = useCallback((id: string) => {
    setFrozenIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setEditingItemId((current) => (current === id ? null : current));
  }, []);

  const editingItem = useMemo(
    () => items.find((item) => item.id === editingItemId) ?? null,
    [editingItemId, items]
  );

  const handleSaveEditingItem = useCallback(
    (_value: {
      itemText: string;
      storeId: string | null;
      recurrence: GroceryRecurrenceSettings;
    }) => {
      if (!editingItemId) return;
    },
    [editingItemId]
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Groceries",
          headerRight: () => <GroceriesMenu viewMode={viewMode} onViewModeChange={setViewMode} />,
        }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustsScrollIndicatorInsets
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140, gap: 14 }}
      >
        <View style={{ gap: 14 }}>
          {isLoading ? (
            <GroceriesStateMessage
              title="Loading groceries"
              body="Getting the latest household list."
              foregroundColor={foregroundColor}
              mutedColor={mutedColor}
            />
          ) : error ? (
            <GroceriesStateMessage
              title="Could not load groceries"
              body="Check your connection and try again."
              foregroundColor={foregroundColor}
              mutedColor={mutedColor}
            />
          ) : sections.length === 0 ? (
            <GroceriesStateMessage
              title="No groceries yet"
              body="Use the add button to start a household grocery list."
              foregroundColor={foregroundColor}
              mutedColor={mutedColor}
            />
          ) : (
            sections.map((section) => (
              <GrocerySectionCard
                key={section.id}
                section={section}
                frozenIds={frozenIds}
                onToggleItem={handleToggleItem}
                onPressItem={handlePressItem}
                onDeleteItem={handleDeleteItem}
              />
            ))
          )}
        </View>
      </ScrollView>

      <GroceryEditorSheet
        isPresented={!!editingItem}
        mode="edit"
        stores={stores}
        initialValue={
          editingItem
            ? {
                itemText: buildGroceryInputText(editingItem),
                storeId: editingItem.storeId ?? null,
                recurrence: {
                  ...DEFAULT_GROCERY_RECURRENCE_SETTINGS,
                  enabled: !!editingItem.recurring,
                },
              }
            : undefined
        }
        onIsPresentedChange={(open) => {
          if (!open) setEditingItemId(null);
        }}
        onSubmit={handleSaveEditingItem}
        onDelete={() => {
          if (editingItemId) handleDeleteItem(editingItemId);
        }}
      />
    </>
  );
}

function GroceriesStateMessage({
  title,
  body,
  foregroundColor,
  mutedColor,
}: {
  title: string;
  body: string;
  foregroundColor: string;
  mutedColor: string;
}) {
  return (
    <View style={{ paddingHorizontal: 18, paddingVertical: 36, gap: 8 }}>
      <Text style={{ color: foregroundColor, fontSize: 18, fontWeight: "700", textAlign: "center" }}>
        {title}
      </Text>
      <Text style={{ color: mutedColor, fontSize: 14, lineHeight: 20, textAlign: "center" }}>
        {body}
      </Text>
    </View>
  );
}
