import type { GroceryStore } from "@/lib/groceries/grocery-mock-data";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PanelButton } from "@/components/shell/panel-button";
import { ShellSheet } from "@/components/shell/sheet";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button, useThemeColor } from "heroui-native";
import { useIntl } from "react-intl";

import { GroceryRecurrenceSheet } from "./grocery-recurrence-sheet";

export type GroceryEditorFormValue = {
  itemText: string;
  storeId: string | null;
  recurring: boolean;
};

type GroceryEditorSheetProps = {
  isPresented: boolean;
  mode: "create" | "edit";
  stores: GroceryStore[];
  initialValue?: GroceryEditorFormValue;
  onIsPresentedChange: (open: boolean) => void;
  onSubmit?: (value: GroceryEditorFormValue) => void;
  onDelete?: () => void;
};

const EMPTY_VALUE: GroceryEditorFormValue = {
  itemText: "",
  storeId: null,
  recurring: false,
};

export function GroceryEditorSheet({
  isPresented,
  mode,
  stores,
  initialValue,
  onIsPresentedChange,
  onSubmit,
  onDelete,
}: GroceryEditorSheetProps) {
  const intl = useIntl();
  const [itemText, setItemText] = useState(initialValue?.itemText ?? "");
  const [storeId, setStoreId] = useState<string | null>(initialValue?.storeId ?? null);
  const [recurring, setRecurring] = useState(initialValue?.recurring ?? false);
  const [recurrenceSheetOpen, setRecurrenceSheetOpen] = useState(false);
  const [foregroundColor, mutedColor, surfaceColor, separatorColor, accentColor] = useThemeColor([
    "foreground",
    "muted",
    "surface-secondary",
    "separator",
    "accent",
  ] as const);

  useEffect(() => {
    if (!isPresented) {
      if (mode === "create") {
        setItemText("");
        setStoreId(null);
        setRecurring(false);
      }
      return;
    }

    const next = initialValue ?? EMPTY_VALUE;
    setItemText(next.itemText);
    setStoreId(next.storeId);
    setRecurring(next.recurring);
  }, [initialValue, isPresented, mode]);

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === storeId) ?? null,
    [storeId, stores]
  );

  const hasText = itemText.trim().length > 0;
  const titleId = mode === "create" ? "groceries.panel.addTitle" : "groceries.panel.editTitle";
  const placeholderId =
    mode === "create" ? "groceries.panel.placeholder" : "groceries.panel.editPlaceholder";

  const handleSubmit = useCallback(() => {
    if (!hasText) return;
    onSubmit?.({ itemText: itemText.trim(), storeId, recurring });
    if (mode === "create") {
      setItemText("");
    } else {
      onIsPresentedChange(false);
    }
  }, [hasText, itemText, mode, onIsPresentedChange, onSubmit, recurring, storeId]);

  const handleDelete = useCallback(() => {
    onDelete?.();
    onIsPresentedChange(false);
  }, [onDelete, onIsPresentedChange]);

  const handleRecurrenceConfirm = useCallback((enabled: boolean) => {
    setRecurring(enabled);
    setRecurrenceSheetOpen(false);
  }, []);

  return (
    <>
      <ShellSheet
        isPresented={isPresented}
        onIsPresentedChange={onIsPresentedChange}
        detents={["medium", "large"]}
        initialDetent="medium"
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: foregroundColor }]}>
              {intl.formatMessage({ id: titleId })}
            </Text>
            <Text style={[styles.subtitle, { color: mutedColor }]}>
              {intl.formatMessage({
                id:
                  mode === "create"
                    ? "groceries.panel.autoDetectFromHistory"
                    : "groceries.panel.savePreference",
              })}
            </Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: mutedColor }]}>
              {intl.formatMessage({ id: "groceries.panel.itemName" })}
            </Text>
            <TextInput
              value={itemText}
              onChangeText={setItemText}
              placeholder={intl.formatMessage({ id: placeholderId })}
              placeholderTextColor={mutedColor}
              returnKeyType={mode === "create" ? "done" : "send"}
              onSubmitEditing={handleSubmit}
              style={[
                styles.textInput,
                {
                  color: foregroundColor,
                  backgroundColor: surfaceColor,
                  borderColor: separatorColor,
                },
              ]}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: mutedColor }]}>
              {intl.formatMessage({
                id:
                  mode === "create"
                    ? "groceries.panel.storeOptional"
                    : "groceries.panel.selectStore",
              })}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.storeList}
            >
              <StoreChip
                label={intl.formatMessage({ id: "groceries.panel.noStore" })}
                selected={!selectedStore}
                tintColor={accentColor}
                foregroundColor={foregroundColor}
                mutedColor={mutedColor}
                surfaceColor={surfaceColor}
                separatorColor={separatorColor}
                onPress={() => setStoreId(null)}
              />
              {stores
                .filter((store) => store.id !== "unsorted")
                .map((store) => (
                  <StoreChip
                    key={store.id}
                    label={store.name}
                    selected={store.id === storeId}
                    tintColor={store.tintColor}
                    foregroundColor={foregroundColor}
                    mutedColor={mutedColor}
                    surfaceColor={surfaceColor}
                    separatorColor={separatorColor}
                    onPress={() => setStoreId(store.id)}
                  />
                ))}
            </ScrollView>
          </View>

          {/* Recurrence row — opens a sub-sheet instead of toggling inline */}
          <Pressable
            onPress={() => setRecurrenceSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={intl.formatMessage({ id: "groceries.panel.recurrence" })}
            style={[
              styles.repeatRow,
              {
                backgroundColor: surfaceColor,
                borderColor: recurring ? accentColor : separatorColor,
              },
            ]}
          >
            <View style={[styles.repeatIcon, { backgroundColor: `${accentColor}18` }]}>
              <Ionicons name="repeat-outline" size={18} color={accentColor} />
            </View>
            <View style={styles.repeatText}>
              <Text style={[styles.repeatTitle, { color: foregroundColor }]}>
                {intl.formatMessage({ id: "groceries.panel.recurrence" })}
              </Text>
              <Text style={[styles.repeatSubtitle, { color: mutedColor }]}>
                {recurring
                  ? intl.formatMessage({ id: "groceries.panel.recurrenceEnabled" })
                  : intl.formatMessage({ id: "groceries.panel.addRepeat" })}
              </Text>
            </View>
            {recurring ? (
              <View style={[styles.activeBadge, { backgroundColor: `${accentColor}18` }]}>
                <Text style={[styles.activeBadgeText, { color: accentColor }]}>On</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color={mutedColor} />
          </Pressable>

          <View style={styles.actions}>
            {mode === "edit" && onDelete ? (
              <PanelButton variant="secondary" onPress={handleDelete}>
                <Ionicons name="trash-outline" size={17} color="#ef4444" />
                <Button.Label style={{ color: "#ef4444" }}>
                  {intl.formatMessage({ id: "common.actions.delete" })}
                </Button.Label>
              </PanelButton>
            ) : null}
            <PanelButton variant="primary" isDisabled={!hasText} onPress={handleSubmit}>
              <Button.Label>
                {intl.formatMessage({
                  id: mode === "create" ? "common.actions.add" : "common.actions.save",
                })}
              </Button.Label>
            </PanelButton>
          </View>
        </View>
      </ShellSheet>

      <GroceryRecurrenceSheet
        isPresented={recurrenceSheetOpen}
        onIsPresentedChange={setRecurrenceSheetOpen}
        recurring={recurring}
        onConfirm={handleRecurrenceConfirm}
      />
    </>
  );
}

type StoreChipProps = {
  label: string;
  selected: boolean;
  tintColor: string;
  foregroundColor: string;
  mutedColor: string;
  surfaceColor: string;
  separatorColor: string;
  onPress: () => void;
};

function StoreChip({
  label,
  selected,
  tintColor,
  foregroundColor,
  mutedColor,
  surfaceColor,
  separatorColor,
  onPress,
}: StoreChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.storeChip,
        {
          backgroundColor: selected ? `${tintColor}18` : surfaceColor,
          borderColor: selected ? tintColor : separatorColor,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.storeDot, { backgroundColor: tintColor }]} />
      <Text style={[styles.storeChipText, { color: selected ? foregroundColor : mutedColor }]}>
        {label}
      </Text>
    </Pressable>
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
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  textInput: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 17,
    fontWeight: "600",
  },
  storeList: {
    gap: 8,
    paddingRight: 20,
  },
  storeChip: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  storeDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  storeChipText: {
    fontSize: 14,
    fontWeight: "700",
  },
  repeatRow: {
    minHeight: 64,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  repeatIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  repeatText: {
    flex: 1,
    gap: 2,
  },
  repeatTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  repeatSubtitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  activeBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  actions: {
    marginTop: "auto",
    flexDirection: "row",
    gap: 10,
  },
});
