"use client";

import { useLocale } from "next-intl";

import { useUnitsQuery } from "@/hooks/config/use-units-query";
import { formatUnit } from "@/lib/unit-localization";

/**
 * Hook that provides locale-aware unit formatting functions.
 * Automatically uses the current user's locale and units configuration.
 */
export function useUnitFormatter() {
  const locale = useLocale();
  const { units } = useUnitsQuery();

  /**
   * Format amount and unit for display (e.g., "500 g" or "2 tbsp")
   * Handles spacing automatically (short units get no space: "500g", longer ones do: "2 tbsp")
   */
  const formatAmountUnit = (
    amount: number | null | undefined,
    unit: string | null | undefined
  ): string => {
    if (!amount && amount !== 0) return "";

    const formattedAmount = amount % 1 === 0 ? amount.toString() : amount.toFixed(1);

    if (!unit) return `${formattedAmount}×`;

    const localizedUnit = formatUnit(unit, locale, units);
    const needsSpace = localizedUnit.length > 2;

    return needsSpace
      ? `${formattedAmount} ${localizedUnit}`
      : `${formattedAmount}${localizedUnit}`;
  };

  return {
    formatAmountUnit,
    locale,
    units,
  };
}
