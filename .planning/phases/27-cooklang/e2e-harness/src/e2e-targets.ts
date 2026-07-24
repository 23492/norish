// SPIKE — Phase 27 (COOK-01). E2E target recipes for the full-pipeline harness.
// -----------------------------------------------------------------------------
// Two REAL, fetch-friendly recipe URLs (Camoufox is not reachable from this
// environment, so the harness uses norish's documented plain-fetch fallback):
//   - Dutch  : LeukeRecepten spaghetti bolognese (norish is NL-focused; DeepSeek is
//              strong on Dutch). Chosen because plain fetch returns 200 + JSON-LD.
//   - English: BBC Good Food classic pancakes.
// (AH Allerhande / Allrecipes were tried first but return 307/403 to a plain fetch —
// they *require* Camoufox, which is unavailable here; recorded in the final report.)
//
// `standin` is the Claude-generated structured extraction of the ACTUAL scraped
// content — used only when DEEPSEEK_API_KEY is absent, so the serializer→.cook→
// reparse half of the pipeline runs for real. When the key is set, run-e2e ignores
// the stand-in and extracts with live DeepSeek from the freshly scraped text.

import type { CooklangExtraction } from "./schema.js";
import type { Expectation } from "./evaluate.js";

export interface E2ETarget {
  url: string;
  language: string;
  standin: CooklangExtraction;
  expectation: Expectation;
}

const RECIPE = "https://schema.org" as const;

export const e2eTargets: E2ETarget[] = [
  {
    url: "https://www.leukerecepten.nl/recepten/spaghetti-bolognese/",
    language: "nl",
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Spaghetti bolognese",
      description: "Klassieke Italiaanse spaghetti bolognese met vers gehakt.",
      recipeYield: 4,
      recipeIngredient: {
        metric: [
          "125 g ontbijtspek",
          "1 ui",
          "150 g wortel",
          "500 g rundergehakt",
          "1 rundvleesbouillonblokje",
          "600 ml tomatenblokjes",
          "1 blikje tomatenpuree",
          "1 theelepel oregano",
          "300 g spaghetti",
          "peper",
          "zout",
          "basilicum",
          "Parmezaanse kaas",
        ],
        us: [
          "4.4 oz ontbijtspek",
          "1 ui",
          "5.3 oz wortel",
          "1.1 lb rundergehakt",
          "1 rundvleesbouillonblokje",
          "2 1/2 cups tomatenblokjes",
          "1 blikje tomatenpuree",
          "1 teaspoon oregano",
          "10.5 oz spaghetti",
          "peper",
          "zout",
          "basilicum",
          "Parmezaanse kaas",
        ],
      },
      recipeInstructions: {
        metric: [
          {
            text: "Bak de ontbijtspek in een droge koekenpan tot het meeste vet is uitgebakken.",
            ingredients: [{ name: "ontbijtspek", amount: 125, unit: "gram" }],
            timers: [],
          },
          {
            text: "Snipper de ui, snijd de wortel in blokjes en voeg toe aan het spek.",
            ingredients: [
              { name: "ui", amount: 1, unit: null },
              { name: "wortel", amount: 150, unit: "gram" },
            ],
            timers: [],
          },
          {
            text: "Voeg het rundergehakt toe en bak rul, roer dan de tomatenpuree erdoor en bak 2 minuten mee.",
            ingredients: [
              { name: "rundergehakt", amount: 500, unit: "gram" },
              { name: "tomatenpuree", amount: 1, unit: null },
            ],
            timers: [{ name: null, amount: 2, unit: "minuten" }],
          },
          {
            text: "Los het rundvleesbouillonblokje op in 100 ml kokend water en voeg met de tomatenblokjes toe aan de pan.",
            ingredients: [
              { name: "rundvleesbouillonblokje", amount: 1, unit: null },
              { name: "tomatenblokjes", amount: 600, unit: "milliliter" },
            ],
            timers: [],
          },
          {
            text: "Breng op smaak met oregano, peper en zout.",
            ingredients: [
              { name: "oregano", amount: 1, unit: "theelepel" },
              { name: "peper", amount: null, unit: null },
              { name: "zout", amount: null, unit: null },
            ],
            timers: [],
          },
          {
            text: "Laat de saus 20 tot 25 minuten pruttelen tot hij is ingedikt.",
            ingredients: [],
            timers: [{ name: null, amount: 20, unit: "minuten" }],
          },
          {
            text: "Kook ondertussen de spaghetti gaar en serveer met de saus, basilicum en Parmezaanse kaas.",
            ingredients: [
              { name: "spaghetti", amount: 300, unit: "gram" },
              { name: "basilicum", amount: null, unit: null },
              { name: "Parmezaanse kaas", amount: null, unit: null },
            ],
            timers: [],
          },
        ],
        us: [
          {
            text: "Bak de ontbijtspek in een droge koekenpan tot het meeste vet is uitgebakken.",
            ingredients: [{ name: "ontbijtspek", amount: 4.4, unit: "oz" }],
            timers: [],
          },
          {
            text: "Snipper de ui, snijd de wortel in blokjes en voeg toe aan het spek.",
            ingredients: [
              { name: "ui", amount: 1, unit: null },
              { name: "wortel", amount: 5.3, unit: "oz" },
            ],
            timers: [],
          },
          {
            text: "Voeg het rundergehakt toe en bak rul, roer dan de tomatenpuree erdoor en bak 2 minuten mee.",
            ingredients: [
              { name: "rundergehakt", amount: 1.1, unit: "lb" },
              { name: "tomatenpuree", amount: 1, unit: null },
            ],
            timers: [{ name: null, amount: 2, unit: "minuten" }],
          },
          {
            text: "Los het rundvleesbouillonblokje op in 100 ml kokend water en voeg met de tomatenblokjes toe aan de pan.",
            ingredients: [
              { name: "rundvleesbouillonblokje", amount: 1, unit: null },
              { name: "tomatenblokjes", amount: "2 1/2", unit: "cups" },
            ],
            timers: [],
          },
          {
            text: "Breng op smaak met oregano, peper en zout.",
            ingredients: [
              { name: "oregano", amount: 1, unit: "teaspoon" },
              { name: "peper", amount: null, unit: null },
              { name: "zout", amount: null, unit: null },
            ],
            timers: [],
          },
          {
            text: "Laat de saus 20 tot 25 minuten pruttelen tot hij is ingedikt.",
            ingredients: [],
            timers: [{ name: null, amount: 20, unit: "minuten" }],
          },
          {
            text: "Kook ondertussen de spaghetti gaar en serveer met de saus, basilicum en Parmezaanse kaas.",
            ingredients: [
              { name: "spaghetti", amount: 10.5, unit: "oz" },
              { name: "basilicum", amount: null, unit: null },
              { name: "Parmezaanse kaas", amount: null, unit: null },
            ],
            timers: [],
          },
        ],
      },
      keywords: ["diner", "italiaans", "pasta"],
      categories: ["Dinner"],
      source: "https://www.leukerecepten.nl/recepten/spaghetti-bolognese/",
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "ontbijtspek", amount: 125, unit: "gram" },
        { step: 1, name: "ui", amount: 1, unit: null },
        { step: 1, name: "wortel", amount: 150, unit: "gram" },
        { step: 2, name: "rundergehakt", amount: 500, unit: "gram" },
        { step: 2, name: "tomatenpuree", amount: 1, unit: null },
        { step: 3, name: "rundvleesbouillonblokje", amount: 1, unit: null },
        { step: 3, name: "tomatenblokjes", amount: 600, unit: "milliliter" },
        { step: 4, name: "oregano", amount: 1, unit: "teaspoon" },
        { step: 6, name: "spaghetti", amount: 300, unit: "gram" },
      ],
      toTaste: ["peper", "zout", "basilicum", "Parmezaanse kaas"],
      allowAppended: 0,
    },
  },
  {
    url: "https://www.bbcgoodfood.com/recipes/classic-pancakes",
    language: "en",
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Classic pancakes",
      description: "A foolproof classic pancake batter for sweet or savoury pancakes.",
      recipeYield: 12,
      recipeIngredient: {
        metric: ["100 g plain flour", "salt", "1 egg", "300 ml milk", "butter"],
        us: ["3/4 cup plain flour", "salt", "1 egg", "1 1/4 cups milk", "butter"],
      },
      recipeInstructions: {
        metric: [
          {
            text: "Sift the plain flour and a pinch of salt into a bowl, make a well, break in the egg and pour in half the milk. Whisk to a smooth batter, then stir in the rest of the milk.",
            ingredients: [
              { name: "plain flour", amount: 100, unit: "gram" },
              { name: "salt", amount: null, unit: null },
              { name: "egg", amount: 1, unit: null },
              { name: "milk", amount: 300, unit: "milliliter" },
            ],
            timers: [],
          },
          {
            text: "Heat a little butter in a frying pan, pour in about 2 tablespoons of batter, tilt to coat the base and cook until golden underneath.",
            ingredients: [{ name: "butter", amount: null, unit: null }],
            timers: [{ name: null, amount: 1, unit: "minutes" }],
          },
          {
            text: "Flip the pancake and cook the other side until golden brown.",
            ingredients: [],
            timers: [],
          },
        ],
        us: [
          {
            text: "Sift the plain flour and a pinch of salt into a bowl, make a well, break in the egg and pour in half the milk. Whisk to a smooth batter, then stir in the rest of the milk.",
            ingredients: [
              { name: "plain flour", amount: "3/4", unit: "cup" },
              { name: "salt", amount: null, unit: null },
              { name: "egg", amount: 1, unit: null },
              { name: "milk", amount: "1 1/4", unit: "cups" },
            ],
            timers: [],
          },
          {
            text: "Heat a little butter in a frying pan, pour in about 2 tablespoons of batter, tilt to coat the base and cook until golden underneath.",
            ingredients: [{ name: "butter", amount: null, unit: null }],
            timers: [{ name: null, amount: 1, unit: "minutes" }],
          },
          {
            text: "Flip the pancake and cook the other side until golden brown.",
            ingredients: [],
            timers: [],
          },
        ],
      },
      keywords: ["breakfast", "pancakes"],
      categories: ["Breakfast"],
      source: "https://www.bbcgoodfood.com/recipes/classic-pancakes",
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "plain flour", amount: 100, unit: "gram" },
        { step: 0, name: "egg", amount: 1, unit: null },
        { step: 0, name: "milk", amount: 300, unit: "milliliter" },
      ],
      toTaste: ["salt", "butter"],
      allowAppended: 0,
    },
  },
];
