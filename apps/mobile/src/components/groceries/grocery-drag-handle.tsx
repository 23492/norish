import React from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useThemeColor } from "heroui-native";

/**
 * Keeps the drag affordance isolated so the real DnD integration can swap in
 * gesture wiring later without changing row layout.
 */
export function GroceryDragHandle() {
  const [mutedColor, borderColor] = useThemeColor(["muted", "separator"] as const);

  return (
    <View
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name="reorder-three-outline" size={18} color={mutedColor} />
    </View>
  );
}
