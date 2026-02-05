/**
 * German Units Configuration Tests (TDD)
 *
 * Tests for German UOM integration in units.default.json.
 */

import { describe, it, expect } from "vitest";

import defaultUnits from "@/config/units.default.json";
import { parseIngredientWithDefaults } from "@/lib/helpers";

describe("German UOM Configuration", () => {
  describe("unit definitions structure", () => {
    const germanUnits = [
      "Becher",
      "Beutel",
      "Blatt",
      "Bund",
      "Dose",
      "Dutzend",
      "EL",
      "Flasche",
      "Glas",
      "Handvoll",
      "Knolle",
      "Kopf",
      "Messerspitze",
      "Packung",
      "Prise",
      "Scheibe",
      "Schuss",
      "Spritzer",
      "Stück",
      "TL",
      "Tropfen",
      "Würfel",
      "Zehe",
      "Zweig",
    ];

    it.each(germanUnits)("has German unit '%s' defined", (unit) => {
      expect(defaultUnits).toHaveProperty(unit);
    });

    it("each German unit has required fields", () => {
      const units = defaultUnits as Record<
        string,
        { short: string; plural: string; alternates: string[] }
      >;

      for (const key of germanUnits) {
        const unit = units[key];

        expect(unit).toHaveProperty("short");
        expect(unit).toHaveProperty("plural");
        expect(unit).toHaveProperty("alternates");
        expect(Array.isArray(unit.alternates)).toBe(true);
      }
    });
  });

  describe("German spoon measurements", () => {
    it("recognizes EL (Esslöffel)", () => {
      const result = parseIngredientWithDefaults("2 EL Öl", defaultUnits as any);

      expect(result[0].quantity).toBe(2);
      expect(result[0].unitOfMeasureID).toBe("EL");
    });

    it("recognizes TL (Teelöffel)", () => {
      const result = parseIngredientWithDefaults("1 TL Salz", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("TL");
    });

    it("recognizes esslöffel alternate", () => {
      const result = parseIngredientWithDefaults("2 esslöffel Zucker", defaultUnits as any);

      expect(result[0].quantity).toBe(2);
      expect(result[0].unitOfMeasureID).toBe("EL");
    });
  });

  describe("German weight/volume units", () => {
    it("recognizes g (Gramm)", () => {
      const result = parseIngredientWithDefaults("500 g Mehl", defaultUnits as any);

      expect(result[0].quantity).toBe(500);
      expect(result[0].unitOfMeasureID).toBe("gram");
    });

    it("recognizes kg (Kilogramm)", () => {
      const result = parseIngredientWithDefaults("1 kg Kartoffeln", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("kilogram");
    });

    it("recognizes ml (Milliliter)", () => {
      const result = parseIngredientWithDefaults("200 ml Milch", defaultUnits as any);

      expect(result[0].quantity).toBe(200);
      expect(result[0].unitOfMeasureID).toBe("milliliter");
    });

    it("recognizes l (Liter)", () => {
      const result = parseIngredientWithDefaults("1 l Wasser", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("liter");
    });
  });

  describe("German container units", () => {
    it("recognizes Dose", () => {
      const result = parseIngredientWithDefaults("1 Dose Tomaten", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("Dose");
    });

    it("recognizes Packung", () => {
      const result = parseIngredientWithDefaults("1 Packung Butter", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("Packung");
    });

    it("recognizes Glas", () => {
      const result = parseIngredientWithDefaults("1 Glas Marmelade", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("Glas");
    });
  });

  describe("German portion units", () => {
    it("recognizes Prise", () => {
      const result = parseIngredientWithDefaults("1 Prise Salz", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("Prise");
    });

    it("recognizes Messerspitze", () => {
      const result = parseIngredientWithDefaults("1 Messerspitze Zimt", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("Messerspitze");
    });

    it("recognizes Handvoll", () => {
      const result = parseIngredientWithDefaults("1 Handvoll Petersilie", defaultUnits as any);

      expect(result[0].quantity).toBe(1);
      expect(result[0].unitOfMeasureID).toBe("Handvoll");
    });
  });

  describe("plural forms", () => {
    it("returns plural for German units when quantity > 1", () => {
      const result = parseIngredientWithDefaults("2 Dosen Tomaten", defaultUnits as any);

      expect(result[0].unitOfMeasure).toBe("Dosen");
    });

    it("returns singular for German units when quantity = 1", () => {
      const result = parseIngredientWithDefaults("1 Dose Tomaten", defaultUnits as any);

      expect(result[0].unitOfMeasure).toBe("Dose");
    });
  });

  describe("coexistence with Dutch/English units", () => {
    it("still recognizes Dutch eetlepel", () => {
      const result = parseIngredientWithDefaults("2 eetlepels olie", defaultUnits as any);

      expect(result[0].quantity).toBe(2);
      expect(result[0].unitOfMeasureID).toBe("el");
    });

    it("still recognizes English cups", () => {
      const result = parseIngredientWithDefaults("2 cups flour", defaultUnits as any);

      expect(result[0].quantity).toBe(2);
      expect(result[0].unitOfMeasureID).toBe("cup");
    });

    it("handles mixed-language recipe", () => {
      const result = parseIngredientWithDefaults(
        ["500 g Mehl", "2 cups milk", "1 EL Öl"],
        defaultUnits as any
      );

      expect(result).toHaveLength(3);
      expect(result[0].unitOfMeasureID).toBe("gram");
      expect(result[1].unitOfMeasureID).toBe("cup");
      expect(result[2].unitOfMeasureID).toBe("EL");
    });
  });
});
