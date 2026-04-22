import type { GroceryViewMode } from "@/lib/groceries/grocery-mock-data";
import React, { useCallback, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import {
  buildRecipeSections,
  buildStoreSections,
  createMockGroceries,
} from "@/lib/groceries/grocery-mock-data";
import { Stack } from "expo-router";

import { GroceriesMenu } from "./groceries-menu";
import { GrocerySectionCard } from "./grocery-section-card";

/** How long to keep a newly-completed item pinned in place before it slides to the bottom. */
const SORT_DELAY_MS = 380;

export function GroceriesScreen() {
  const [viewMode, setViewMode] = useState<GroceryViewMode>("store");
  const [items, setItems] = useState(createMockGroceries);
  const [frozenIds, setFrozenIds] = useState<ReadonlySet<string>>(new Set());

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

  return (
    <>
      <Stack.Screen
        options={{
          title: "Groceries",
          headerRight: () => (
            <GroceriesMenu viewMode={viewMode} onViewModeChange={setViewMode} />
          ),
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
              onToggleItem={handleToggleItem}
            />
          ))}
        </View>
      </ScrollView>
    </>
  );
}
