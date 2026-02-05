/**
 * Unit Localization Tests (Issue #253)
 *
 * Tests for locale-aware unit display using the existing units configuration.
 */

import { describe, it, expect } from "vitest";

import {
  getLocalizedUnit,
  getLocalizedUnitWithFallback,
  hasLocaleTranslation,
  getSupportedLocalesFromUnits,
} from "@/lib/unit-localization";
import type { UnitsMap } from "@/server/db/zodSchemas/server-config";

// Mock units configuration with locale-specific forms
const mockUnits: UnitsMap = {
  gram: {
    short: "g",
    plural: "grams",
    alternates: ["g", "g.", "gram", "grams"],
    locales: {
      de: { singular: "Gramm", plural: "Gramm" },
      nl: { singular: "gram", plural: "gram" },
      fr: { singular: "gramme", plural: "grammes" },
    },
  },
  kilogram: {
    short: "kg",
    plural: "kilograms",
    alternates: ["kg", "kg.", "kilogram", "kilograms"],
    locales: {
      de: { singular: "Kilogramm", plural: "Kilogramm" },
      nl: { singular: "kilogram", plural: "kilogram" },
      fr: { singular: "kilogramme", plural: "kilogrammes" },
    },
  },
  tablespoon: {
    short: "tbsp",
    plural: "tablespoons",
    alternates: ["tbsp", "tbsp.", "tablespoon", "tablespoons"],
    locales: {
      de: { singular: "Esslöffel", plural: "Esslöffel" },
      nl: { singular: "eetlepel", plural: "eetlepels" },
      fr: { singular: "cuillère à soupe", plural: "cuillères à soupe" },
    },
  },
  teaspoon: {
    short: "tsp",
    plural: "teaspoons",
    alternates: ["tsp", "tsp.", "teaspoon", "teaspoons"],
    locales: {
      de: { singular: "Teelöffel", plural: "Teelöffel" },
      nl: { singular: "theelepel", plural: "theelepels" },
      fr: { singular: "cuillère à café", plural: "cuillères à café" },
    },
  },
  can: {
    short: "can",
    plural: "cans",
    alternates: ["can", "cans", "tin"],
    locales: {
      de: { singular: "Dose", plural: "Dosen" },
      nl: { singular: "blik", plural: "blikken" },
      fr: { singular: "boîte", plural: "boîtes" },
    },
  },
  pinch: {
    short: "pinch",
    plural: "pinches",
    alternates: ["pinch", "pinches"],
    locales: {
      de: { singular: "Prise", plural: "Prisen" },
      nl: { singular: "snuf", plural: "snufjes" },
      fr: { singular: "pincée", plural: "pincées" },
    },
  },
  // Unit without locale-specific forms (fallback to English)
  cup: {
    short: "c",
    plural: "cups",
    alternates: ["c", "c.", "cup", "cups"],
  },
};

describe("Unit Localization", () => {
  describe("getLocalizedUnit", () => {
    describe("German locale (de)", () => {
      it("returns German singular for gram when quantity = 1", () => {
        expect(getLocalizedUnit("gram", 1, "de", mockUnits)).toBe("Gramm");
      });

      it("returns German plural for gram when quantity > 1", () => {
        expect(getLocalizedUnit("gram", 500, "de", mockUnits)).toBe("Gramm");
      });

      it("returns German for kilogram", () => {
        expect(getLocalizedUnit("kilogram", 1, "de", mockUnits)).toBe("Kilogramm");
        expect(getLocalizedUnit("kilogram", 2, "de", mockUnits)).toBe("Kilogramm");
      });

      it("returns German for tablespoon (Esslöffel)", () => {
        expect(getLocalizedUnit("tablespoon", 1, "de", mockUnits)).toBe("Esslöffel");
        expect(getLocalizedUnit("tablespoon", 2, "de", mockUnits)).toBe("Esslöffel");
      });

      it("returns German for teaspoon (Teelöffel)", () => {
        expect(getLocalizedUnit("teaspoon", 1, "de", mockUnits)).toBe("Teelöffel");
      });

      it("returns German plural for Dose (can)", () => {
        expect(getLocalizedUnit("can", 1, "de", mockUnits)).toBe("Dose");
        expect(getLocalizedUnit("can", 2, "de", mockUnits)).toBe("Dosen");
      });

      it("returns German for Prise (pinch)", () => {
        expect(getLocalizedUnit("pinch", 1, "de", mockUnits)).toBe("Prise");
        expect(getLocalizedUnit("pinch", 2, "de", mockUnits)).toBe("Prisen");
      });
    });

    describe("German variants (de-formal, de-informal)", () => {
      it("normalizes de-formal to de", () => {
        expect(getLocalizedUnit("gram", 500, "de-formal", mockUnits)).toBe("Gramm");
        expect(getLocalizedUnit("tablespoon", 2, "de-formal", mockUnits)).toBe("Esslöffel");
      });

      it("normalizes de-informal to de", () => {
        expect(getLocalizedUnit("gram", 500, "de-informal", mockUnits)).toBe("Gramm");
        expect(getLocalizedUnit("tablespoon", 2, "de-informal", mockUnits)).toBe("Esslöffel");
      });
    });

    describe("English locale (en)", () => {
      it("returns English singular for gram when quantity = 1", () => {
        expect(getLocalizedUnit("gram", 1, "en", mockUnits)).toBe("gram");
      });

      it("returns English plural for gram when quantity > 1", () => {
        expect(getLocalizedUnit("gram", 500, "en", mockUnits)).toBe("grams");
      });

      it("returns English for tablespoon with proper pluralization", () => {
        expect(getLocalizedUnit("tablespoon", 1, "en", mockUnits)).toBe("tablespoon");
        expect(getLocalizedUnit("tablespoon", 2, "en", mockUnits)).toBe("tablespoons");
      });
    });

    describe("Dutch locale (nl)", () => {
      it("returns Dutch for gram", () => {
        expect(getLocalizedUnit("gram", 500, "nl", mockUnits)).toBe("gram");
      });

      it("returns Dutch for eetlepel (tablespoon)", () => {
        expect(getLocalizedUnit("tablespoon", 1, "nl", mockUnits)).toBe("eetlepel");
        expect(getLocalizedUnit("tablespoon", 2, "nl", mockUnits)).toBe("eetlepels");
      });

      it("returns Dutch for theelepel (teaspoon)", () => {
        expect(getLocalizedUnit("teaspoon", 1, "nl", mockUnits)).toBe("theelepel");
      });
    });

    describe("French locale (fr)", () => {
      it("returns French for gramme", () => {
        expect(getLocalizedUnit("gram", 1, "fr", mockUnits)).toBe("gramme");
        expect(getLocalizedUnit("gram", 500, "fr", mockUnits)).toBe("grammes");
      });

      it("returns French for cuillère à soupe (tablespoon)", () => {
        expect(getLocalizedUnit("tablespoon", 1, "fr", mockUnits)).toBe("cuillère à soupe");
        expect(getLocalizedUnit("tablespoon", 2, "fr", mockUnits)).toBe("cuillères à soupe");
      });
    });

    describe("Fallback behavior", () => {
      it("falls back to English for unknown locale", () => {
        expect(getLocalizedUnit("gram", 500, "es", mockUnits)).toBe("grams");
        expect(getLocalizedUnit("tablespoon", 2, "ja", mockUnits)).toBe("tablespoons");
      });

      it("falls back to English for unit without locale forms", () => {
        expect(getLocalizedUnit("cup", 1, "de", mockUnits)).toBe("cup");
        expect(getLocalizedUnit("cup", 2, "de", mockUnits)).toBe("cups");
      });

      it("returns original unitId for unknown unit", () => {
        expect(getLocalizedUnit("unknownUnit", 1, "de", mockUnits)).toBe("unknownUnit");
      });

      it("returns null for null/undefined unitId", () => {
        expect(getLocalizedUnit(null, 1, "de", mockUnits)).toBeNull();
        expect(getLocalizedUnit(undefined, 1, "en", mockUnits)).toBeNull();
      });
    });

    describe("Quantity edge cases", () => {
      it("uses singular for quantity = 0", () => {
        expect(getLocalizedUnit("gram", 0, "en", mockUnits)).toBe("gram");
      });

      it("uses singular for quantity = 0.5", () => {
        expect(getLocalizedUnit("cup", 0.5, "en", mockUnits)).toBe("cup");
      });

      it("uses singular for quantity = 1", () => {
        expect(getLocalizedUnit("cup", 1, "en", mockUnits)).toBe("cup");
      });

      it("uses plural for quantity = 1.5", () => {
        expect(getLocalizedUnit("cup", 1.5, "en", mockUnits)).toBe("cups");
      });

      it("uses singular for null quantity", () => {
        expect(getLocalizedUnit("cup", null, "en", mockUnits)).toBe("cup");
      });

      it("uses singular for undefined quantity", () => {
        expect(getLocalizedUnit("cup", undefined, "en", mockUnits)).toBe("cup");
      });
    });
  });

  describe("getLocalizedUnitWithFallback", () => {
    it("returns localized unit when available", () => {
      expect(getLocalizedUnitWithFallback("gram", "g", 500, "de", mockUnits)).toBe("Gramm");
    });

    it("returns original unit when no localization found", () => {
      expect(getLocalizedUnitWithFallback("cup", "cups", 2, "de", mockUnits)).toBe("cups");
    });

    it("returns original unit for unknown unit ID", () => {
      expect(getLocalizedUnitWithFallback("unknown", "some unit", 1, "de", mockUnits)).toBe(
        "some unit"
      );
    });

    it("returns empty string when no unit available", () => {
      expect(getLocalizedUnitWithFallback(null, null, 1, "de", mockUnits)).toBe("");
    });
  });

  describe("hasLocaleTranslation", () => {
    it("returns true for unit with locale translation", () => {
      expect(hasLocaleTranslation(mockUnits.gram, "de")).toBe(true);
      expect(hasLocaleTranslation(mockUnits.gram, "nl")).toBe(true);
      expect(hasLocaleTranslation(mockUnits.gram, "fr")).toBe(true);
    });

    it("returns true for locale variants", () => {
      expect(hasLocaleTranslation(mockUnits.gram, "de-formal")).toBe(true);
      expect(hasLocaleTranslation(mockUnits.gram, "de-informal")).toBe(true);
    });

    it("returns false for unit without locale translation", () => {
      expect(hasLocaleTranslation(mockUnits.cup, "de")).toBe(false);
    });

    it("returns false for undefined unit", () => {
      expect(hasLocaleTranslation(undefined, "de")).toBe(false);
    });

    it("returns false for unsupported locale", () => {
      expect(hasLocaleTranslation(mockUnits.gram, "es")).toBe(false);
    });
  });

  describe("getSupportedLocalesFromUnits", () => {
    it("returns array of supported locales", () => {
      const locales = getSupportedLocalesFromUnits(mockUnits);

      expect(locales).toContain("de");
      expect(locales).toContain("nl");
      expect(locales).toContain("fr");
    });

    it("does not include en (as it uses default forms)", () => {
      const locales = getSupportedLocalesFromUnits(mockUnits);

      // English uses the default short/plural, not locales object
      expect(locales).not.toContain("en");
    });

    it("returns empty array for units without locale forms", () => {
      const unitsWithoutLocales: UnitsMap = {
        cup: {
          short: "c",
          plural: "cups",
          alternates: ["c", "cup", "cups"],
        },
      };

      expect(getSupportedLocalesFromUnits(unitsWithoutLocales)).toEqual([]);
    });
  });
});
