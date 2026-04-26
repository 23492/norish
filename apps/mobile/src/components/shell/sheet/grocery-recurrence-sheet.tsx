import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { PanelButton } from "@/components/shell/panel-button";
import { ShellSheet } from "@/components/shell/sheet";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, useThemeColor } from "heroui-native";
import { useIntl } from "react-intl";

type RecurrenceFrequency = "weekly" | "biweekly" | "monthly";

type GroceryRecurrenceSheetProps = {
  isPresented: boolean;
  onIsPresentedChange: (open: boolean) => void;
  recurring: boolean;
  onConfirm: (enabled: boolean) => void;
};

const FREQUENCY_OPTIONS: { id: RecurrenceFrequency; labelId: string; icon: string }[] = [
  { id: "weekly", labelId: "groceries.panel.recurrenceSheet.weekly", icon: "calendar-outline" },
  { id: "biweekly", labelId: "groceries.panel.recurrenceSheet.biweekly", icon: "swap-horizontal-outline" },
  { id: "monthly", labelId: "groceries.panel.recurrenceSheet.monthly", icon: "calendar-number-outline" },
];

export function GroceryRecurrenceSheet({
  isPresented,
  onIsPresentedChange,
  recurring,
  onConfirm,
}: GroceryRecurrenceSheetProps) {
  const intl = useIntl();
  const [enabled, setEnabled] = useState(recurring);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekly");
  const [foregroundColor, mutedColor, surfaceColor, separatorColor, accentColor] = useThemeColor([
    "foreground",
    "muted",
    "surface-secondary",
    "separator",
    "accent",
  ] as const);

  // Sync state when sheet opens
  React.useEffect(() => {
    if (isPresented) {
      setEnabled(recurring);
    }
  }, [isPresented, recurring]);

  const handleConfirm = useCallback(() => {
    onConfirm(enabled);
  }, [enabled, onConfirm]);

  return (
    <ShellSheet
      isPresented={isPresented}
      onIsPresentedChange={onIsPresentedChange}
      detents={["medium"]}
      initialDetent="medium"
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: foregroundColor }]}>
            {intl.formatMessage({ id: "groceries.panel.recurrenceSheet.title" })}
          </Text>
          <Text style={[styles.subtitle, { color: mutedColor }]}>
            {intl.formatMessage({ id: "groceries.panel.recurrenceSheet.subtitle" })}
          </Text>
        </View>

        {/* Enable/Disable toggle row */}
        <Pressable
          onPress={() => setEnabled((v) => !v)}
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
          style={[
            styles.toggleRow,
            {
              backgroundColor: surfaceColor,
              borderColor: enabled ? accentColor : separatorColor,
            },
          ]}
        >
          <View style={[styles.toggleIcon, { backgroundColor: `${accentColor}18` }]}>
            <Ionicons name="repeat-outline" size={20} color={accentColor} />
          </View>
          <View style={styles.toggleText}>
            <Text style={[styles.toggleTitle, { color: foregroundColor }]}>
              {intl.formatMessage({
                id: enabled
                  ? "groceries.panel.recurrenceSheet.disable"
                  : "groceries.panel.recurrenceSheet.enable",
              })}
            </Text>
          </View>

          {/* Animated checkmark / circle */}
          <View style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center" }}>
            {enabled ? (
              <Animated.View
                key="enabled"
                entering={ZoomIn.duration(180)}
                exiting={ZoomOut.duration(120)}
              >
                <Ionicons name="checkmark-circle" size={24} color={accentColor} />
              </Animated.View>
            ) : (
              <Animated.View
                key="disabled"
                entering={FadeIn.duration(140)}
                exiting={FadeOut.duration(100)}
              >
                <Ionicons name="ellipse-outline" size={24} color={mutedColor} />
              </Animated.View>
            )}
          </View>
        </Pressable>

        {/* Frequency options — only visible when enabled */}
        {enabled ? (
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(140)}>
            <Text style={[styles.sectionLabel, { color: mutedColor }]}>
              {intl.formatMessage({ id: "groceries.panel.recurrenceSheet.frequency" })}
            </Text>
            <View style={styles.frequencyGroup}>
              {FREQUENCY_OPTIONS.map((option) => {
                const isSelected = frequency === option.id;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => setFrequency(option.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.frequencyChip,
                      {
                        backgroundColor: isSelected ? `${accentColor}18` : surfaceColor,
                        borderColor: isSelected ? accentColor : separatorColor,
                      },
                    ]}
                  >
                    <Ionicons
                      name={option.icon as React.ComponentProps<typeof Ionicons>["name"]}
                      size={16}
                      color={isSelected ? accentColor : mutedColor}
                    />
                    <Text
                      style={[
                        styles.frequencyLabel,
                        { color: isSelected ? foregroundColor : mutedColor },
                      ]}
                    >
                      {intl.formatMessage({ id: option.labelId })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>
        ) : null}

        {/* Confirm */}
        <View style={styles.actions}>
          <PanelButton variant="primary" onPress={handleConfirm}>
            <Button.Label>
              {intl.formatMessage({ id: "groceries.panel.recurrenceSheet.confirm" })}
            </Button.Label>
          </PanelButton>
        </View>
      </View>
    </ShellSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 18,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  toggleRow: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  toggleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  frequencyGroup: {
    flexDirection: "row",
    gap: 8,
  },
  frequencyChip: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  frequencyLabel: {
    fontSize: 13,
    fontWeight: "700",
  },
  actions: {
    marginTop: "auto",
    flexDirection: "row",
    gap: 10,
  },
});
