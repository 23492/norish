import type { GroceryRowModel } from "@/lib/groceries/grocery-mock-data";
import React from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useThemeColor } from "heroui-native";

import { GroceryDragHandle } from "./grocery-drag-handle";

type GroceryRowProps = {
  item: GroceryRowModel;
  tintColor: string;
  isLast: boolean;
  onToggle?: (id: string) => void;
};

export function GroceryRow({ item, tintColor, isLast, onToggle }: GroceryRowProps) {
  const [foregroundColor, mutedColor, separatorColor, successColor, backgroundColor] =
    useThemeColor(["foreground", "muted", "separator", "success", "background"] as const);

  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 13,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: separatorColor,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      }}
    >
      {/* Drag handle — left side */}
      <GroceryDragHandle />

      {/* Checkmark circle */}
      <Pressable
        onPress={() => onToggle?.(item.id)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: item.completed }}
        hitSlop={8}
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: item.completed ? 0 : 2,
          borderColor: `${tintColor}70`,
          backgroundColor: item.completed ? successColor : "transparent",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {item.completed ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      </Pressable>

      {/* Content */}
      <View style={{ flex: 1, gap: 4 }}>
        {/* Name + amount */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              flex: 1,
              color: foregroundColor,
              fontSize: 16,
              lineHeight: 21,
              fontWeight: "600",
              textDecorationLine: item.completed ? "line-through" : "none",
              opacity: item.completed ? 0.45 : 1,
            }}
          >
            {item.name}
          </Text>

          <View
            style={{
              borderRadius: 9,
              paddingHorizontal: 9,
              paddingVertical: 4,
              backgroundColor,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: item.completed ? mutedColor : foregroundColor,
                fontSize: 12,
                fontWeight: "700",
                opacity: item.completed ? 0.5 : 1,
              }}
            >
              {item.amount}
            </Text>
          </View>
        </View>

        {/* Tags — recurring + context label on same line */}
        {(item.recurring || item.contextLabel) ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {item.recurring ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 7,
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  backgroundColor: `${tintColor}18`,
                }}
              >
                <Ionicons name="repeat-outline" size={11} color={tintColor} />
                <Text style={{ color: tintColor, fontSize: 11, fontWeight: "700" }}>Recurring</Text>
              </View>
            ) : null}

            {item.contextLabel ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 7,
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  backgroundColor,
                }}
              >
                <Ionicons name="sparkles-outline" size={11} color={mutedColor} />
                <Text style={{ color: mutedColor, fontSize: 11, fontWeight: "600" }}>
                  {item.contextLabel}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
