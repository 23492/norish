import type { GroceryRecurrenceSettings } from "@/components/shell/sheet/grocery-recurrence-sheet";
import type {
  GroceryItem,
  GroceryRowModel,
  GroceryViewMode,
} from "@/lib/groceries/grocery-mock-data";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { GroceryEditorSheet } from "@/components/shell/sheet/grocery-editor-sheet";
import { DEFAULT_GROCERY_RECURRENCE_SETTINGS } from "@/components/shell/sheet/grocery-recurrence-sheet";
import {
  buildRecipeSections,
  buildStoreSections,
  createMockGroceries,
  getMockGroceryStores,
} from "@/lib/groceries/grocery-mock-data";
import { Stack } from "expo-router";

import { GroceriesMenu } from "./groceries-menu";
import { GrocerySectionCard } from "./grocery-section-card";

/** How long to keep a newly-completed item pinned in place before it slides to the bottom. */
const SORT_DELAY_MS = 380;

function buildGroceryInputText(item: GroceryItem) {
  return [item.amount, item.name].filter(Boolean).join(" ");
}

function applyGroceryInputText(item: GroceryItem, input: string): GroceryItem {
  const trimmed = input.trim();
  const match = trimmed.match(
    /^((?:\d+(?:[./]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:ct|oz|lb|lbs|g|kg|ml|l|jar|bunch|cans?|blocks?|tin|pack|packs?)?)\s+(.+)$/i
  );

  if (!match) {
    return { ...item, name: trimmed, amount: item.amount || "1" };
  }

  return {
    ...item,
    amount: match[1]?.trim() ?? item.amount,
    name: match[2]?.trim() ?? trimmed,
  };
}

export function GroceriesScreen() {
  const [viewMode, setViewMode] = useState<GroceryViewMode>("store");
  const [items, setItems] = useState(createMockGroceries);
  const [frozenIds, setFrozenIds] = useState<ReadonlySet<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const stores = useMemo(() => getMockGroceryStores(), []);

  const sections = useMemo(
    () =>
      viewMode === "store"
        ? buildStoreSections(items, frozenIds)
        : buildRecipeSections(items, frozenIds),
    [items, viewMode, frozenIds]
  );

  const handleToggleItem = useCallback((id: string) => {
    const now = Date.now();

    // Update the item immediately so the checkmark renders right away.
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, completed: !item.completed, toggledAt: now } : item
      )
    );

    // Pin the item in its current position until the animation finishes.
    setFrozenIds((prev) => new Set([...prev, id]));
    setTimeout(() => {
      setFrozenIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, SORT_DELAY_MS);
  }, []);

  const handleReorderItems = useCallback((_sectionId: string, orderedIds: string[]) => {
    setItems((prev) => {
      // Build a sortOrder map from the new order.
      const orderMap = new Map(orderedIds.map((id, index) => [id, index]));
      return prev.map((item) => {
        const newOrder = orderMap.get(item.id);
        if (newOrder !== undefined) {
          return { ...item, sortOrder: newOrder };
        }
        return item;
      });
    });
  }, []);

  const handlePressItem = useCallback((item: GroceryRowModel) => {
    setEditingItemId(item.id);
  }, []);

  const handleDeleteItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
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
    (value: {
      itemText: string;
      storeId: string | null;
      recurrence: GroceryRecurrenceSettings;
    }) => {
      if (!editingItemId) return;
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== editingItemId) return item;
          return {
            ...applyGroceryInputText(item, value.itemText),
            storeId: value.storeId ?? undefined,
            recurring: value.recurrence.enabled,
          };
        })
      );
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
          {sections.map((section) => (
            <GrocerySectionCard
              key={section.id}
              section={section}
              frozenIds={frozenIds}
              onToggleItem={handleToggleItem}
              onPressItem={handlePressItem}
              onDeleteItem={handleDeleteItem}
              onReorderItems={handleReorderItems}
            />
          ))}
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
