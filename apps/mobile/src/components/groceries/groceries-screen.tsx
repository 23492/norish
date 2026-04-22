import type { GroceryViewMode } from "@/lib/groceries/grocery-mock-data";
import React, { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import {
  buildRecipeSections,
  buildStoreSections,
  createMockGroceries,
} from "@/lib/groceries/grocery-mock-data";
import { Stack } from "expo-router";

import { GroceriesMenu } from "./groceries-menu";
import { GrocerySectionCard } from "./grocery-section-card";

export function GroceriesScreen() {
  const [viewMode, setViewMode] = useState<GroceryViewMode>("store");
  const [items, setItems] = useState(createMockGroceries);

  const sections = viewMode === "store" ? buildStoreSections(items) : buildRecipeSections(items);

  const handleToggleItem = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item))
    );
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
