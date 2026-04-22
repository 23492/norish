import type { GrocerySectionModel } from "@/lib/groceries/grocery-mock-data";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
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

  const totalCount = section.items.length;
  const doneCount = section.items.filter((i) => i.completed).length;
  const allDone = totalCount > 0 && doneCount === totalCount;

  // Sections that are fully done on first mount start collapsed; user can reopen freely.
  const [collapsed, setCollapsed] = useState(
    () => totalCount > 0 && section.items.every((i) => i.completed)
  );

  return (
    <Card variant="secondary" className="overflow-hidden rounded-[28px]">
      <Card.Body className="p-0">
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
              {/* Dot → checkmark: plain timing animations, no spring/bounce */}
              <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "center" }}>
                {allDone ? (
                  <Animated.View
                    key="check"
                    entering={ZoomIn.duration(200)}
                    exiting={ZoomOut.duration(140)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: section.tintColor,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="checkmark" size={13} color="#fff" />
                  </Animated.View>
                ) : (
                  <Animated.View
                    key="dot"
                    entering={FadeIn.duration(160)}
                    exiting={FadeOut.duration(120)}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      backgroundColor: section.tintColor,
                    }}
                  />
                )}
              </View>

              {/* Title — no strikethrough */}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: allDone ? mutedColor : foregroundColor,
                    fontSize: 17,
                    lineHeight: 22,
                    fontWeight: "700",
                    opacity: allDone ? 0.6 : 1,
                  }}
                >
                  {section.title}
                </Text>
              </View>

              {/* Done count pill — always uses tint color */}
              <View
                style={{
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  backgroundColor: `${section.tintColor}18`,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <Text style={{ color: section.tintColor, fontSize: 13, fontWeight: "700" }}>
                  {doneCount}/{totalCount}
                </Text>
                <Text style={{ color: `${section.tintColor}90`, fontSize: 12, fontWeight: "500" }}>
                  {" done"}
                </Text>
              </View>

              <Ionicons
                name={collapsed ? "chevron-forward" : "chevron-down"}
                size={16}
                color={mutedColor}
              />
            </View>
          )}
        </Pressable>

        {!collapsed ? (
          <Animated.View
            layout={LinearTransition.duration(300)}
            style={{ borderTopWidth: 1, borderTopColor: separatorColor }}
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
          </Animated.View>
        ) : null}
      </Card.Body>
    </Card>
  );
}
