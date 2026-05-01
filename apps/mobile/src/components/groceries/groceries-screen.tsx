import type { GroceryRecurrenceSettings } from "@/components/shell/sheet/grocery-recurrence-sheet";
import type { GroceryDto } from "@norish/shared/contracts";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useGroceriesDataContext, useGroceriesUiContext } from "@/context/groceries-context";
import { GroceryEditorSheet } from "@/components/shell/sheet/grocery-editor-sheet";
import { DEFAULT_GROCERY_RECURRENCE_SETTINGS } from "@/components/shell/sheet/grocery-recurrence-sheet";
import { useStoresContext } from "@/context/stores-context";
import {
  buildRecipeSections,
  buildStoreSections,
  formatAmountUnit,
} from "@/lib/groceries/grocery-utils";
import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native";

import { GroceriesMenu } from "./groceries-menu";
import { GrocerySectionCard } from "./grocery-section-card";

/** How long to keep a newly-completed item pinned in place before it slides to the bottom. */
const SORT_DELAY_MS = 380;

function buildGroceryInputText(item: GroceryDto) {
  return [formatAmountUnit(item.amount, item.unit), item.name].filter(Boolean).join(" ");
}

export function GroceriesScreen() {
  const { query: groceriesQuery, mutations } = useGroceriesDataContext();
  const { viewMode, setViewMode } = useGroceriesUiContext();
  const [frozenIds, setFrozenIds] = useState<ReadonlySet<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const { stores, isLoading: storesLoading } = useStoresContext();
  const [foregroundColor, mutedColor] = useThemeColor(["foreground", "muted"] as const);

  const sections = useMemo(
    () =>
      viewMode === "store"
        ? buildStoreSections({
            groceries: groceriesQuery.groceries,
            stores,
            recipeMap: groceriesQuery.recipeMap,
            frozenIds,
          })
        : buildRecipeSections({
            groceries: groceriesQuery.groceries,
            stores,
            recipeMap: groceriesQuery.recipeMap,
            frozenIds,
          }),
    [groceriesQuery.groceries, stores, groceriesQuery.recipeMap, viewMode, frozenIds]
  );

  const isLoading = groceriesQuery.isLoading || storesLoading;
  const error = groceriesQuery.error;

  const handleToggleItem = useCallback(
    (id: string) => {
      const item = groceriesQuery.groceries.find((i) => i.id === id);
      if (!item) return;

      const newIsDone = !item.isDone;

      // Freeze position so the row stays pinned during the completion animation.
      setFrozenIds((prev) => new Set([...prev, id]));
      setTimeout(() => {
        setFrozenIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, SORT_DELAY_MS);

      // Persist to backend via shared mutations (handles optimistic cache + error invalidation).
      if (item.recurringGroceryId) {
        mutations.toggleRecurringGrocery(item.recurringGroceryId, id, newIsDone);
      } else {
        mutations.toggleGroceries([id], newIsDone);
      }
    },
    [groceriesQuery.groceries, mutations]
  );

  const handlePressItem = useCallback((item: GroceryDto) => {
    setEditingItemId(item.id);
  }, []);

  const handleDeleteItem = useCallback(
    (id: string) => {
      // Clean up local transient state.
      setFrozenIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setEditingItemId((current) => (current === id ? null : current));

      // Persist deletion to backend via shared mutations.
      const item = groceriesQuery.groceries.find((i) => i.id === id);
      if (!item) return;

      if (item.recurringGroceryId) {
        mutations.deleteRecurringGrocery(item.recurringGroceryId);
      } else {
        mutations.deleteGroceries([id]);
      }
    },
    [groceriesQuery.groceries, mutations]
  );

  const editingItem = useMemo(
    () => groceriesQuery.groceries.find((item) => item.id === editingItemId) ?? null,
    [editingItemId, groceriesQuery.groceries]
  );
  const editingRecurringGrocery = editingItem
    ? mutations.getRecurringGroceryForGrocery(editingItem.id)
    : null;

  const handleSaveEditingItem = useCallback(
    (value: {
      itemText: string;
      storeId: string | null;
      recurrence: GroceryRecurrenceSettings;
    }) => {
      if (!editingItemId || !editingItem) return;

      const { itemText, storeId, recurrence } = value;

      if (editingItem.recurringGroceryId) {
        // Recurring item — route through updateRecurringGrocery.
        // Pass pattern when recurrence stays enabled, null to disable it.
        mutations.updateRecurringGrocery(
          editingItem.recurringGroceryId,
          editingItemId,
          itemText,
          recurrence.enabled ? recurrence.pattern : null
        );
      } else if (recurrence.enabled) {
        // Was one-off, user enabled recurrence → delete old one-off, create recurring.
        mutations.deleteGroceries([editingItemId]);
        mutations.createRecurringGrocery(itemText, recurrence.pattern, storeId);
      } else {
        // One-off item — update text and store separately.
        mutations.updateGrocery(editingItemId, itemText);
      }

      // Handle store assignment for non-conversion cases.
      const storeChanged = (editingItem.storeId ?? null) !== storeId;
      if (storeChanged && !(editingItem.recurringGroceryId == null && recurrence.enabled)) {
        mutations.assignGroceryToStore(editingItemId, storeId);
      }

      setEditingItemId(null);
    },
    [editingItemId, editingItem, mutations]
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
                recurringGroceries={groceriesQuery.recurringGroceries}
                recipeMap={groceriesQuery.recipeMap}
                stores={stores}
                contextMode={viewMode}
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
                  enabled: !!editingRecurringGrocery,
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
