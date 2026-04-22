import type { GrocerySectionModel } from "@/lib/groceries/grocery-mock-data";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Card, useThemeColor } from "heroui-native";

import { GroceryRow } from "./grocery-row";

type GrocerySectionCardProps = {
  section: GrocerySectionModel;
  onToggleItem?: (id: string) => void;
};

export function GrocerySectionCard({ section, onToggleItem }: GrocerySectionCardProps) {
  const [foregroundColor, mutedColor, separatorColor] = useThemeColor(
    ["foreground", "muted", "separator"] as const
  );
  const [collapsed, setCollapsed] = useState(false);

  const totalCount = section.items.length;
  const doneCount = section.items.filter((i) => i.completed).length;

  return (
    <Card variant="secondary" className="overflow-hidden rounded-[28px]">
      <Card.Body className="p-0">
        {/* Section header — tappable to collapse */}
        <Pressable
          onPress={() => setCollapsed((c) => !c)}
          accessibilityRole="button"
          accessibilityState={{ expanded: !collapsed }}
          accessibilityLabel={`${section.title}, ${collapsed ? "expand" : "collapse"}`}
        >
          {({ pressed }) => (
            <View
              style={{
                paddingHorizontal: 18,
                paddingTop: 18,
                paddingBottom: collapsed ? 18 : 14,
                opacity: pressed ? 0.75 : 1,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Color dot */}
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: section.tintColor,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              />

              {/* Title + subtitle */}
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{ color: foregroundColor, fontSize: 17, lineHeight: 22, fontWeight: "700" }}>
                  {section.title}
                </Text>
                <Text style={{ color: mutedColor, fontSize: 13, lineHeight: 18 }}>
                  {section.subtitle}
                </Text>
              </View>

              {/* Item count pill — always shows done/total */}
              <View
                style={{
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  backgroundColor: doneCount === totalCount && totalCount > 0
                    ? `${section.tintColor}18`
                    : `${section.tintColor}12`,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <Text
                  style={{
                    color: section.tintColor,
                    fontSize: 13,
                    fontWeight: "700",
                    opacity: doneCount === totalCount ? 1 : 0.9,
                  }}
                >
                  {doneCount}/{totalCount}
                </Text>
                <Text style={{ color: `${section.tintColor}90`, fontSize: 12, fontWeight: "500" }}>
                  {" done"}
                </Text>
              </View>

              {/* Chevron */}
              <Ionicons
                name={collapsed ? "chevron-forward" : "chevron-down"}
                size={16}
                color={mutedColor}
              />
            </View>
          )}
        </Pressable>

        {/* Items list — hidden when collapsed */}
        {!collapsed ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: separatorColor,
            }}
          >
            {section.items.map((item, index) => (
              <GroceryRow
                key={item.id}
                item={item}
                tintColor={section.tintColor}
                isLast={index === section.items.length - 1}
                onToggle={onToggleItem}
              />
            ))}
          </View>
        ) : null}
      </Card.Body>
    </Card>
  );
}
