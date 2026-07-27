import { useUnitsQuery } from "@/hooks/config";
import { useMobileLocaleSettings } from "@/context/mobile-i18n-context";

import { useUnitFormatter as useSharedUnitFormatter } from "@norish/shared-react/hooks";

/**
 * Mobile's counterpart to `apps/web/hooks/use-unit-formatter.ts` (D-27-W4-04).
 * Mobile never had `formatUnit` wiring — the ingredient list still prints
 * the raw canonical unit — so this hook exists for the NEW cook-token
 * render path only; the ingredient list is out of W4 scope.
 */
export function useUnitFormatter() {
  const { locale } = useMobileLocaleSettings();
  const { units } = useUnitsQuery();

  return useSharedUnitFormatter({ locale, units });
}
