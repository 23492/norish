import type { UnitsMap } from "./zod/server-config";

import defaultUnits from "./units.default.json";
import { UnitsConfigSchema, UnitsMapSchema } from "./zod/server-config";

/**
 * D-27-W5P-05 — the units-config no-op trap, closed at the READ boundary.
 *
 * `syncUnits()` (`packages/api/src/startup/seed-config.ts`) only migrates the
 * WRAPPER SHAPE of the stored `server_config.units` row — unlike `syncPrompts` /
 * `syncTimerKeywords` it never compares the file's CONTENT to the stored map.
 * So on any install that already has a seeded `units` row (which includes live),
 * adding a key to `units.default.json` alone is a SILENT NO-OP — structurally
 * identical to the `loadPrompt` trap D-27-W3-01 already caught this fork on.
 *
 * The fix is a READ-TIME merge, not a boot-time write: `resolveUnitsMap`
 * returns `{ ...defaultUnits, ...storedMap }` for every stored shape it
 * recognizes — the STORED value wins per key (an admin override is never
 * silently replaced, T-27-W5P-01), and a key present only in the file (e.g. a
 * newly added canonical unit) falls through from the file. No DB write, no
 * migration, no boot-time mutation — fully reversible.
 *
 * This is the single door both units readers go through, replacing the
 * four-branch stored-value fallback that used to be duplicated verbatim in
 * `getUnits` (`@norish/shared-server`) and `getUnitsForNormalization`
 * (`@norish/db`) — the W3 lesson (one door, not two).
 */
export function resolveUnitsMap(value: unknown): UnitsMap {
  const defaults = defaultUnits as UnitsMap;

  const wrapped = UnitsConfigSchema.safeParse(value);

  if (wrapped.success) {
    return { ...defaults, ...wrapped.data.units };
  }

  // Pre-v0.16 wrapper: `{ units: {...}, isOverwritten: boolean }`.
  const legacyWrapped =
    typeof value === "object" && value !== null && "units" in value && "isOverwritten" in value
      ? UnitsMapSchema.safeParse((value as { units: unknown }).units)
      : null;

  if (legacyWrapped?.success) {
    return { ...defaults, ...legacyWrapped.data };
  }

  // Bare legacy map (no wrapper at all).
  const legacy = UnitsMapSchema.safeParse(value);

  if (legacy.success) {
    return { ...defaults, ...legacy.data };
  }

  return defaults;
}
