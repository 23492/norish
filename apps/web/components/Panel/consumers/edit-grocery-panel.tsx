"use client";

import { useEffect, useState } from "react";
import { RecurrenceSuggestion } from "@/app/(app)/groceries/components/recurrence-suggestion";
import { StoreSelector } from "@/components/groceries/store-selector";
import { RecurrencePanel } from "@/components/Panel/consumers/recurrence-panel";
import Panel, { PANEL_HEIGHT_COMPACT } from "@/components/Panel/Panel";
import { useRecurrenceDetection } from "@/hooks/use-recurrence-detection";
import { Button, Input } from "@heroui/react";
import { AnimatePresence } from "motion/react";
import { useTranslations } from "next-intl";

import type { GroceryDto, RecurringGroceryDto, StoreDto } from "@norish/shared/contracts";
import type { RecurrencePattern } from "@norish/shared/contracts/recurrence";
import { useGroceryFormState } from "@norish/shared-react/hooks";

type EditGroceryPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grocery: GroceryDto;
  recurringGrocery: RecurringGroceryDto | null;
  stores: StoreDto[];
  onSave: (itemName: string, pattern: RecurrencePattern | null) => void;
  onAssignToStore: (storeId: string | null, savePreference?: boolean) => void;
  onDelete: () => void;
};
export default function EditGroceryPanel({
  open,
  onOpenChange,
  grocery,
  recurringGrocery,
  stores,
  onSave,
  onAssignToStore,
  onDelete,
}: EditGroceryPanelProps) {
  const t = useTranslations("groceries.panel");
  const tActions = useTranslations("common.actions");
  const [recurrencePanelOpen, setRecurrencePanelOpen] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [hasStoreChanged, setHasStoreChanged] = useState(false);
  const {
    itemName,
    setItemName,
    confirmedPattern,
    setConfirmedPattern,
    handleConfirmPattern,
    handleRemovePattern,
    reset,
  } = useGroceryFormState();
  const { detectedPattern } = useRecurrenceDetection({
    itemName,
    enabled: open && !recurrencePanelOpen,
  });

  // Initialize form with grocery data when opening
  useEffect(() => {
    if (open) {
      const text = [grocery.amount, grocery.unit, grocery.name].filter(Boolean).join(" ");
      setItemName(text);
      setSelectedStoreId(grocery.storeId ?? null);
      setHasStoreChanged(false);
      if (recurringGrocery) {
        setConfirmedPattern({
          rule: recurringGrocery.recurrenceRule as "day" | "week" | "month",
          interval: recurringGrocery.recurrenceInterval,
          weekday: recurringGrocery.recurrenceWeekday ?? undefined,
        });
      } else {
        setConfirmedPattern(null);
      }
    } else {
      reset();
    }
  }, [open, grocery, recurringGrocery, setItemName, setConfirmedPattern, reset]);
  const handleStoreChange = (storeId: string | null) => {
    setSelectedStoreId(storeId);
    setHasStoreChanged(storeId !== (grocery.storeId ?? null));
  };
  const handleSubmit = () => {
    const trimmed = itemName.trim();
    if (!trimmed) return;
    onSave(trimmed, confirmedPattern);

    // If store changed, save that too (with preference)
    if (hasStoreChanged) {
      onAssignToStore(selectedStoreId, true);
    }
    onOpenChange(false);
  };
  const handleRecurrenceSave = (pattern: RecurrencePattern | null) => {
    setConfirmedPattern(pattern);
    setRecurrencePanelOpen(false);
  };
  return (
    <>
      <Panel
        height={PANEL_HEIGHT_COMPACT}
        open={open && !recurrencePanelOpen}
        title={t("editTitle")}
        onOpenChange={onOpenChange}
      >
        <Panel.Body>
          <div className="space-y-3">
            <Input
              className="h-12 text-base font-medium"
              variant="secondary"
              placeholder={t("editPlaceholder")}
              style={{
                fontSize: "16px",
              }}
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />

            {/* Store selection */}
            <StoreSelector
              showWhenEmpty
              label={t("selectStore")}
              selectedStoreId={selectedStoreId}
              stores={stores}
              onSelectionChange={handleStoreChange}
            />

            {/* Recurrence Pills Container */}
            <AnimatePresence mode="popLayout">
              <div className="flex flex-wrap items-center gap-2">
                {/* Suggested pill  */}
                {detectedPattern && (
                  <RecurrenceSuggestion
                    key="detected"
                    itemName={itemName}
                    pattern={detectedPattern.pattern}
                    type="detected"
                    onReplace={() => handleConfirmPattern(detectedPattern)}
                  />
                )}

                {/* Active pill */}
                {confirmedPattern && (
                  <RecurrenceSuggestion
                    key="confirmed"
                    itemName={itemName}
                    pattern={confirmedPattern}
                    type="confirmed"
                    onEdit={() => setRecurrencePanelOpen(true)}
                    onRemove={handleRemovePattern}
                  />
                )}
              </div>
            </AnimatePresence>

            {/* Link to manual recurrence editor */}
            {!confirmedPattern && !detectedPattern && (
              <Button
                className="-mt-1 min-w-16 font-medium"
                size="sm"
                onPress={() => setRecurrencePanelOpen(true)}
                variant="tertiary"
              >
                {t("addRepeat")}
              </Button>
            )}
          </div>
        </Panel.Body>
        <Panel.Footer>
          <div className="flex justify-end gap-2">
            <Button className="min-w-24" onPress={onDelete} variant="danger-soft">
              {tActions("delete")}
            </Button>
            <Button
              className="min-w-24"
              isDisabled={!itemName.trim()}
              onPress={handleSubmit}
              variant="primary"
            >
              {tActions("save")}
            </Button>
          </div>
        </Panel.Footer>
      </Panel>

      {/* Recurrence Panel */}
      <RecurrencePanel
        initialPattern={confirmedPattern}
        open={recurrencePanelOpen}
        returnToPreviousPanel={() => setRecurrencePanelOpen(false)}
        onOpenChange={setRecurrencePanelOpen}
        onSave={handleRecurrenceSave}
      />
    </>
  );
}
