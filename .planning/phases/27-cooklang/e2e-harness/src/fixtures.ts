// SPIKE — Phase 27 (COOK-01). Eval fixtures for the extraction skill.
// -----------------------------------------------------------------------------
// Each fixture is a realistic recipe in the norish shape, targeting one or more of
// the failure modes catalogued in 27-EXPERIMENT.md:
//   - amount split across steps (the irreducible MISS)          -> curry
//   - ingredient used/named in >1 step                          -> bolognese, stamppot
//   - substring / name-collision                                -> cookies, guacamole
//   - "to taste" / no amount                                    -> most
//   - unnamed garnish anchored in the serve step                -> bolognese
//   - section headings                                          -> cookies
//   - Dutch-language recipe (norish is NL-focused)              -> stamppot
//
// `standin` is the Claude-generated structured extraction (playing the model with
// the linkage prompt), i.e. what DeepSeek is EXPECTED to emit. `content` is a
// realistic scraped-text version of the recipe, so the SAME fixtures re-run against
// live DeepSeek (`npm run evals -- --live`) by extracting from `content`.
// `expectation` is the ground truth the assertion engine checks.

import type { CooklangExtraction } from "./schema.js";
import type { Expectation } from "./evaluate.js";

export interface Fixture {
  id: string;
  name: string;
  language: string;
  failureModes: string[];
  content: string; // realistic scraped text (for --live re-runs)
  standin: CooklangExtraction;
  expectation: Expectation;
  expectedConfidence: "trusted" | "low";
}

const RECIPE = "https://schema.org" as const;

export const fixtures: Fixture[] = [
  // 1. PANCAKES — best case (every ingredient named once, one clear amount) ------
  {
    id: "pancakes",
    name: "Basic Pancakes",
    language: "en",
    failureModes: ["to-taste (salt)"],
    content: `Basic Pancakes
Serves 4.
Ingredients: 200 g flour, 300 ml milk, 2 eggs, salt, 15 g butter.
1. Whisk the flour, milk, eggs and a pinch of salt into a smooth batter.
2. Heat a little butter in a frying pan over medium heat.
3. Pour in a ladle of batter and cook for 2 minutes per side until golden.`,
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Basic Pancakes",
      description: "Simple everyday pancakes.",
      recipeYield: 4,
      recipeIngredient: {
        metric: ["200 g flour", "300 ml milk", "2 eggs", "salt", "15 g butter"],
        us: ["1 2/3 cups flour", "1 1/4 cups milk", "2 eggs", "salt", "1 tbsp butter"],
      },
      recipeInstructions: {
        metric: [
          {
            text: "Whisk the flour, milk, eggs and a pinch of salt into a smooth batter.",
            ingredients: [
              { name: "flour", amount: 200, unit: "gram" },
              { name: "milk", amount: 300, unit: "milliliter" },
              { name: "eggs", amount: 2, unit: null },
              { name: "salt", amount: null, unit: null },
            ],
            timers: [],
          },
          {
            text: "Heat a little butter in a frying pan over medium heat.",
            ingredients: [{ name: "butter", amount: 15, unit: "gram" }],
            timers: [],
          },
          {
            text: "Pour in a ladle of batter and cook for 2 minutes per side until golden.",
            ingredients: [],
            timers: [{ name: null, amount: 2, unit: "minutes" }],
          },
        ],
        us: [
          {
            text: "Whisk the flour, milk, eggs and a pinch of salt into a smooth batter.",
            ingredients: [
              { name: "flour", amount: "1 2/3", unit: "cups" },
              { name: "milk", amount: "1 1/4", unit: "cups" },
              { name: "eggs", amount: 2, unit: null },
              { name: "salt", amount: null, unit: null },
            ],
            timers: [],
          },
          {
            text: "Heat a little butter in a frying pan over medium heat.",
            ingredients: [{ name: "butter", amount: 1, unit: "tbsp" }],
            timers: [],
          },
          {
            text: "Pour in a ladle of batter and cook for 2 minutes per side until golden.",
            ingredients: [],
            timers: [{ name: null, amount: 2, unit: "minutes" }],
          },
        ],
      },
      keywords: ["breakfast"],
      categories: ["Breakfast"],
      source: null,
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "flour", amount: 200, unit: "gram" },
        { step: 0, name: "milk", amount: 300, unit: "milliliter" },
        { step: 0, name: "eggs", amount: 2, unit: null },
        { step: 1, name: "butter", amount: 15, unit: "gram" },
      ],
      toTaste: ["salt"],
      allowAppended: 0,
    },
    expectedConfidence: "trusted",
  },

  // 2. SPAGHETTI BOLOGNESE — multi-step onion/garlic + garnish + to-taste + timer -
  {
    id: "bolognese",
    name: "Spaghetti Bolognese",
    language: "en",
    failureModes: ["multi-step (onion, garlic)", "garnish (parmesan)", "to-taste (salt)"],
    content: `Spaghetti Bolognese
Serves 4.
Ingredients: 1 onion, 2 cloves garlic, 2 tablespoons olive oil, 500 g minced beef,
400 g chopped tomatoes, 2 tablespoons tomato paste, salt, 400 g spaghetti, 50 g parmesan.
1. Finely chop the onion and garlic.
2. Fry the onion and garlic in olive oil, then add the minced beef and brown it.
3. Stir in the chopped tomatoes and tomato paste, season with salt and simmer for 30 minutes.
4. Meanwhile cook the spaghetti until al dente.
5. Serve topped with grated parmesan.`,
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Spaghetti Bolognese",
      description: "Classic Italian meat sauce with spaghetti.",
      recipeYield: 4,
      recipeIngredient: {
        metric: [
          "1 onion",
          "2 cloves garlic",
          "2 tablespoons olive oil",
          "500 g minced beef",
          "400 g chopped tomatoes",
          "2 tablespoons tomato paste",
          "salt",
          "400 g spaghetti",
          "50 g parmesan",
        ],
        us: [
          "1 onion",
          "2 cloves garlic",
          "2 tablespoons olive oil",
          "1.1 lb minced beef",
          "14 oz chopped tomatoes",
          "2 tablespoons tomato paste",
          "salt",
          "14 oz spaghetti",
          "1.8 oz parmesan",
        ],
      },
      recipeInstructions: {
        metric: [
          {
            text: "Finely chop the onion and garlic.",
            ingredients: [
              { name: "onion", amount: 1, unit: null },
              { name: "garlic", amount: 2, unit: "clove" },
            ],
            timers: [],
          },
          {
            text: "Fry the onion and garlic in olive oil, then add the minced beef and brown it.",
            ingredients: [
              { name: "onion", amount: null, unit: null },
              { name: "garlic", amount: null, unit: null },
              { name: "olive oil", amount: 2, unit: "tablespoon" },
              { name: "minced beef", amount: 500, unit: "gram" },
            ],
            timers: [],
          },
          {
            text: "Stir in the chopped tomatoes and tomato paste, season with salt and simmer for 30 minutes.",
            ingredients: [
              { name: "chopped tomatoes", amount: 400, unit: "gram" },
              { name: "tomato paste", amount: 2, unit: "tablespoon" },
              { name: "salt", amount: null, unit: null },
            ],
            timers: [{ name: null, amount: 30, unit: "minutes" }],
          },
          {
            text: "Meanwhile cook the spaghetti until al dente.",
            ingredients: [{ name: "spaghetti", amount: 400, unit: "gram" }],
            timers: [],
          },
          {
            text: "Serve topped with grated parmesan.",
            ingredients: [{ name: "parmesan", amount: 50, unit: "gram" }],
            timers: [],
          },
        ],
        us: [
          {
            text: "Finely chop the onion and garlic.",
            ingredients: [
              { name: "onion", amount: 1, unit: null },
              { name: "garlic", amount: 2, unit: "clove" },
            ],
            timers: [],
          },
          {
            text: "Fry the onion and garlic in olive oil, then add the minced beef and brown it.",
            ingredients: [
              { name: "onion", amount: null, unit: null },
              { name: "garlic", amount: null, unit: null },
              { name: "olive oil", amount: 2, unit: "tablespoon" },
              { name: "minced beef", amount: 1.1, unit: "lb" },
            ],
            timers: [],
          },
          {
            text: "Stir in the chopped tomatoes and tomato paste, season with salt and simmer for 30 minutes.",
            ingredients: [
              { name: "chopped tomatoes", amount: 14, unit: "oz" },
              { name: "tomato paste", amount: 2, unit: "tablespoon" },
              { name: "salt", amount: null, unit: null },
            ],
            timers: [{ name: null, amount: 30, unit: "minutes" }],
          },
          {
            text: "Meanwhile cook the spaghetti until al dente.",
            ingredients: [{ name: "spaghetti", amount: 14, unit: "oz" }],
            timers: [],
          },
          {
            text: "Serve topped with grated parmesan.",
            ingredients: [{ name: "parmesan", amount: 1.8, unit: "oz" }],
            timers: [],
          },
        ],
      },
      keywords: ["dinner", "italian", "pasta"],
      categories: ["Dinner"],
      source: null,
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "onion", amount: 1, unit: null },
        { step: 0, name: "garlic", amount: 2, unit: "clove" },
        { step: 1, name: "olive oil", amount: 2, unit: "tablespoon" },
        { step: 1, name: "minced beef", amount: 500, unit: "gram" },
        { step: 2, name: "chopped tomatoes", amount: 400, unit: "gram" },
        { step: 2, name: "tomato paste", amount: 2, unit: "tablespoon" },
        { step: 3, name: "spaghetti", amount: 400, unit: "gram" },
        { step: 4, name: "parmesan", amount: 50, unit: "gram" },
      ],
      toTaste: ["salt"],
      multiStep: ["onion", "garlic"],
      allowAppended: 0,
    },
    expectedConfidence: "trusted",
  },

  // 3. GUACAMOLE — substring collisions (lime/lime juice, tomato/chopped tomato) --
  {
    id: "guacamole",
    name: "Guacamole",
    language: "en",
    failureModes: ["substring collision (lime, tomato)", "to-taste (salt)"],
    content: `Guacamole
Serves 4.
Ingredients: 3 avocados, 1 lime, 0.5 red onion, 1 tomato, salt, 10 g cilantro.
1. Mash the avocados in a bowl.
2. Stir in the lime juice, red onion and chopped tomato.
3. Season with salt to taste and garnish with cilantro.`,
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Guacamole",
      description: "Fresh avocado dip.",
      recipeYield: 4,
      recipeIngredient: {
        metric: ["3 avocados", "1 lime", "0.5 red onion", "1 tomato", "salt", "10 g cilantro"],
        us: ["3 avocados", "1 lime", "0.5 red onion", "1 tomato", "salt", "0.35 oz cilantro"],
      },
      recipeInstructions: {
        metric: [
          {
            text: "Mash the avocados in a bowl.",
            ingredients: [{ name: "avocados", amount: 3, unit: null }],
            timers: [],
          },
          {
            text: "Stir in the lime juice, red onion and chopped tomato.",
            ingredients: [
              { name: "lime", amount: 1, unit: null },
              { name: "red onion", amount: 0.5, unit: null },
              { name: "tomato", amount: 1, unit: null },
            ],
            timers: [],
          },
          {
            text: "Season with salt to taste and garnish with cilantro.",
            ingredients: [
              { name: "salt", amount: null, unit: null },
              { name: "cilantro", amount: 10, unit: "gram" },
            ],
            timers: [],
          },
        ],
        us: [
          {
            text: "Mash the avocados in a bowl.",
            ingredients: [{ name: "avocados", amount: 3, unit: null }],
            timers: [],
          },
          {
            text: "Stir in the lime juice, red onion and chopped tomato.",
            ingredients: [
              { name: "lime", amount: 1, unit: null },
              { name: "red onion", amount: 0.5, unit: null },
              { name: "tomato", amount: 1, unit: null },
            ],
            timers: [],
          },
          {
            text: "Season with salt to taste and garnish with cilantro.",
            ingredients: [
              { name: "salt", amount: null, unit: null },
              { name: "cilantro", amount: 0.35, unit: "oz" },
            ],
            timers: [],
          },
        ],
      },
      keywords: ["snack", "mexican"],
      categories: ["Snack"],
      source: null,
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "avocados", amount: 3, unit: null },
        { step: 1, name: "lime", amount: 1, unit: null },
        { step: 1, name: "red onion", amount: 0.5, unit: null },
        { step: 1, name: "tomato", amount: 1, unit: null },
        { step: 2, name: "cilantro", amount: 10, unit: "gram" },
      ],
      toTaste: ["salt"],
      allowAppended: 0,
    },
    expectedConfidence: "trusted",
  },

  // 4. CHOCOLATE CHIP COOKIES — sugar/brown sugar collision + section headings ----
  {
    id: "cookies",
    name: "Chocolate Chip Cookies",
    language: "en",
    failureModes: ["substring collision (sugar/brown sugar)", "sections"],
    content: `Chocolate Chip Cookies
Makes 24.
Ingredients: 115 g butter, 100 g sugar, 150 g brown sugar, 1 egg, 1 teaspoon vanilla,
250 g flour, 1 teaspoon baking soda, 200 g chocolate chips.
Dough
1. Cream the butter with the sugar and brown sugar until fluffy.
2. Beat in the egg and vanilla.
3. Fold in the flour, baking soda and chocolate chips.
Bake
4. Bake at 180C for 12 minutes until golden.`,
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Chocolate Chip Cookies",
      description: "Chewy cookies with two sugars.",
      recipeYield: 24,
      recipeIngredient: {
        metric: [
          "115 g butter",
          "100 g sugar",
          "150 g brown sugar",
          "1 egg",
          "1 teaspoon vanilla",
          "250 g flour",
          "1 teaspoon baking soda",
          "200 g chocolate chips",
        ],
        us: [
          "1/2 cup butter",
          "1/2 cup sugar",
          "3/4 cup brown sugar",
          "1 egg",
          "1 teaspoon vanilla",
          "2 cups flour",
          "1 teaspoon baking soda",
          "1 1/3 cups chocolate chips",
        ],
      },
      recipeInstructions: {
        metric: [
          { text: "# Dough", ingredients: [], timers: [] },
          {
            text: "Cream the butter with the sugar and brown sugar until fluffy.",
            ingredients: [
              { name: "butter", amount: 115, unit: "gram" },
              { name: "sugar", amount: 100, unit: "gram" },
              { name: "brown sugar", amount: 150, unit: "gram" },
            ],
            timers: [],
          },
          {
            text: "Beat in the egg and vanilla.",
            ingredients: [
              { name: "egg", amount: 1, unit: null },
              { name: "vanilla", amount: 1, unit: "teaspoon" },
            ],
            timers: [],
          },
          {
            text: "Fold in the flour, baking soda and chocolate chips.",
            ingredients: [
              { name: "flour", amount: 250, unit: "gram" },
              { name: "baking soda", amount: 1, unit: "teaspoon" },
              { name: "chocolate chips", amount: 200, unit: "gram" },
            ],
            timers: [],
          },
          { text: "# Bake", ingredients: [], timers: [] },
          {
            text: "Bake at 180C for 12 minutes until golden.",
            ingredients: [],
            timers: [{ name: null, amount: 12, unit: "minutes" }],
          },
        ],
        us: [
          { text: "# Dough", ingredients: [], timers: [] },
          {
            text: "Cream the butter with the sugar and brown sugar until fluffy.",
            ingredients: [
              { name: "butter", amount: "1/2", unit: "cup" },
              { name: "sugar", amount: "1/2", unit: "cup" },
              { name: "brown sugar", amount: "3/4", unit: "cup" },
            ],
            timers: [],
          },
          {
            text: "Beat in the egg and vanilla.",
            ingredients: [
              { name: "egg", amount: 1, unit: null },
              { name: "vanilla", amount: 1, unit: "teaspoon" },
            ],
            timers: [],
          },
          {
            text: "Fold in the flour, baking soda and chocolate chips.",
            ingredients: [
              { name: "flour", amount: 2, unit: "cups" },
              { name: "baking soda", amount: 1, unit: "teaspoon" },
              { name: "chocolate chips", amount: "1 1/3", unit: "cups" },
            ],
            timers: [],
          },
          { text: "# Bake", ingredients: [], timers: [] },
          {
            text: "Bake at 350F for 12 minutes until golden.",
            ingredients: [],
            timers: [{ name: null, amount: 12, unit: "minutes" }],
          },
        ],
      },
      keywords: ["snack", "dessert", "baking"],
      categories: ["Snack"],
      source: null,
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "butter", amount: 115, unit: "gram" },
        { step: 0, name: "sugar", amount: 100, unit: "gram" },
        { step: 0, name: "brown sugar", amount: 150, unit: "gram" },
        { step: 1, name: "egg", amount: 1, unit: null },
        { step: 1, name: "vanilla", amount: 1, unit: "teaspoon" },
        { step: 2, name: "flour", amount: 250, unit: "gram" },
        { step: 2, name: "baking soda", amount: 1, unit: "teaspoon" },
        { step: 2, name: "chocolate chips", amount: 200, unit: "gram" },
      ],
      sections: ["Dough", "Bake"],
      allowAppended: 0,
    },
    expectedConfidence: "trusted",
  },

  // 5. THAI GREEN CURRY — split-amount coconut milk (irreducible MISS -> low conf) -
  {
    id: "thai-green-curry",
    name: "Thai Green Curry",
    language: "en",
    failureModes: ["split amount (coconut milk)", "multi-step (coconut milk)"],
    content: `Thai Green Curry
Serves 4.
Ingredients: 3 tablespoons green curry paste, 400 ml coconut milk, 500 g chicken,
1 tablespoon fish sauce, 200 g bamboo shoots, 15 g Thai basil, 300 g rice.
1. Fry the green curry paste in a little of the coconut milk until fragrant.
2. Add the chicken and pour in the rest of the coconut milk and the fish sauce.
3. Add the bamboo shoots and simmer for 15 minutes.
4. Finish with Thai basil and serve with rice.`,
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Thai Green Curry",
      description: "Fragrant Thai curry.",
      recipeYield: 4,
      recipeIngredient: {
        metric: [
          "3 tablespoons green curry paste",
          "400 ml coconut milk",
          "500 g chicken",
          "1 tablespoon fish sauce",
          "200 g bamboo shoots",
          "15 g Thai basil",
          "300 g rice",
        ],
        us: [
          "3 tablespoons green curry paste",
          "1 2/3 cups coconut milk",
          "1.1 lb chicken",
          "1 tablespoon fish sauce",
          "7 oz bamboo shoots",
          "0.5 oz Thai basil",
          "1 1/2 cups rice",
        ],
      },
      recipeInstructions: {
        metric: [
          {
            text: "Fry the green curry paste in a little of the coconut milk until fragrant.",
            ingredients: [
              { name: "green curry paste", amount: 3, unit: "tablespoon" },
              { name: "coconut milk", amount: null, unit: null },
            ],
            timers: [],
          },
          {
            text: "Add the chicken and pour in the rest of the coconut milk and the fish sauce.",
            ingredients: [
              { name: "chicken", amount: 500, unit: "gram" },
              { name: "coconut milk", amount: 400, unit: "milliliter" },
              { name: "fish sauce", amount: 1, unit: "tablespoon" },
            ],
            timers: [],
          },
          {
            text: "Add the bamboo shoots and simmer for 15 minutes.",
            ingredients: [{ name: "bamboo shoots", amount: 200, unit: "gram" }],
            timers: [{ name: null, amount: 15, unit: "minutes" }],
          },
          {
            text: "Finish with Thai basil and serve with rice.",
            ingredients: [
              { name: "Thai basil", amount: 15, unit: "gram" },
              { name: "rice", amount: 300, unit: "gram" },
            ],
            timers: [],
          },
        ],
        us: [
          {
            text: "Fry the green curry paste in a little of the coconut milk until fragrant.",
            ingredients: [
              { name: "green curry paste", amount: 3, unit: "tablespoon" },
              { name: "coconut milk", amount: null, unit: null },
            ],
            timers: [],
          },
          {
            text: "Add the chicken and pour in the rest of the coconut milk and the fish sauce.",
            ingredients: [
              { name: "chicken", amount: 1.1, unit: "lb" },
              { name: "coconut milk", amount: "1 2/3", unit: "cups" },
              { name: "fish sauce", amount: 1, unit: "tablespoon" },
            ],
            timers: [],
          },
          {
            text: "Add the bamboo shoots and simmer for 15 minutes.",
            ingredients: [{ name: "bamboo shoots", amount: 7, unit: "oz" }],
            timers: [{ name: null, amount: 15, unit: "minutes" }],
          },
          {
            text: "Finish with Thai basil and serve with rice.",
            ingredients: [
              { name: "Thai basil", amount: 0.5, unit: "oz" },
              { name: "rice", amount: "1 1/2", unit: "cups" },
            ],
            timers: [],
          },
        ],
      },
      keywords: ["dinner", "thai", "curry"],
      categories: ["Dinner"],
      source: null,
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "green curry paste", amount: 3, unit: "tablespoon" },
        { step: 0, name: "coconut milk", amount: null, unit: null },
        { step: 1, name: "chicken", amount: 500, unit: "gram" },
        { step: 1, name: "coconut milk", amount: 400, unit: "milliliter" },
        { step: 1, name: "fish sauce", amount: 1, unit: "tablespoon" },
        { step: 2, name: "bamboo shoots", amount: 200, unit: "gram" },
        { step: 3, name: "Thai basil", amount: 15, unit: "gram" },
        { step: 3, name: "rice", amount: 300, unit: "gram" },
      ],
      multiStep: ["coconut milk"],
      splitAmount: ["coconut milk"],
      allowAppended: 0,
    },
    expectedConfidence: "low",
  },

  // 6. ANDIJVIESTAMPPOT (Dutch) — multi-step (aardappelen, ui) + to-taste + timer --
  {
    id: "andijviestamppot",
    name: "Andijviestamppot met spekjes",
    language: "nl",
    failureModes: ["multi-step (aardappelen, ui)", "to-taste (zout, peper)", "Dutch"],
    content: `Andijviestamppot met spekjes
Voor 4 personen.
Ingrediënten: 1 kg kruimige aardappelen, 300 g andijvie, 150 g spekblokjes, 1 ui,
100 ml melk, zout, peper.
1. Schil de aardappelen en kook ze in 20 minuten gaar.
2. Bak de spekblokjes uit en fruit de ui glazig.
3. Giet de aardappelen af, voeg de melk toe en stamp tot een grove puree.
4. Schep de andijvie en de ui erdoor en breng op smaak met zout en peper.`,
    standin: {
      "@context": RECIPE,
      "@type": "Recipe",
      name: "Andijviestamppot met spekjes",
      description: "Hollandse stamppot met rauwe andijvie en spekjes.",
      recipeYield: 4,
      recipeIngredient: {
        metric: [
          "1 kg kruimige aardappelen",
          "300 g andijvie",
          "150 g spekblokjes",
          "1 ui",
          "100 ml melk",
          "zout",
          "peper",
        ],
        us: [
          "2.2 lb kruimige aardappelen",
          "10.5 oz andijvie",
          "5.3 oz spekblokjes",
          "1 ui",
          "1/2 cup melk",
          "zout",
          "peper",
        ],
      },
      recipeInstructions: {
        metric: [
          {
            text: "Schil de aardappelen en kook ze in 20 minuten gaar.",
            ingredients: [{ name: "aardappelen", amount: 1, unit: "kilogram" }],
            timers: [{ name: null, amount: 20, unit: "minuten" }],
          },
          {
            text: "Bak de spekblokjes uit en fruit de ui glazig.",
            ingredients: [
              { name: "spekblokjes", amount: 150, unit: "gram" },
              { name: "ui", amount: 1, unit: null },
            ],
            timers: [],
          },
          {
            text: "Giet de aardappelen af, voeg de melk toe en stamp tot een grove puree.",
            ingredients: [
              { name: "aardappelen", amount: null, unit: null },
              { name: "melk", amount: 100, unit: "milliliter" },
            ],
            timers: [],
          },
          {
            text: "Schep de andijvie en de ui erdoor en breng op smaak met zout en peper.",
            ingredients: [
              { name: "andijvie", amount: 300, unit: "gram" },
              { name: "ui", amount: null, unit: null },
              { name: "zout", amount: null, unit: null },
              { name: "peper", amount: null, unit: null },
            ],
            timers: [],
          },
        ],
        us: [
          {
            text: "Schil de aardappelen en kook ze in 20 minuten gaar.",
            ingredients: [{ name: "aardappelen", amount: 2.2, unit: "lb" }],
            timers: [{ name: null, amount: 20, unit: "minuten" }],
          },
          {
            text: "Bak de spekblokjes uit en fruit de ui glazig.",
            ingredients: [
              { name: "spekblokjes", amount: 5.3, unit: "oz" },
              { name: "ui", amount: 1, unit: null },
            ],
            timers: [],
          },
          {
            text: "Giet de aardappelen af, voeg de melk toe en stamp tot een grove puree.",
            ingredients: [
              { name: "aardappelen", amount: null, unit: null },
              { name: "melk", amount: "1/2", unit: "cup" },
            ],
            timers: [],
          },
          {
            text: "Schep de andijvie en de ui erdoor en breng op smaak met zout en peper.",
            ingredients: [
              { name: "andijvie", amount: 10.5, unit: "oz" },
              { name: "ui", amount: null, unit: null },
              { name: "zout", amount: null, unit: null },
              { name: "peper", amount: null, unit: null },
            ],
            timers: [],
          },
        ],
      },
      keywords: ["diner", "hollands", "stamppot"],
      categories: ["Dinner"],
      source: null,
    },
    expectation: {
      inlineAmounts: [
        { step: 0, name: "aardappelen", amount: 1, unit: "kilogram" },
        { step: 1, name: "spekblokjes", amount: 150, unit: "gram" },
        { step: 1, name: "ui", amount: 1, unit: null },
        { step: 2, name: "melk", amount: 100, unit: "milliliter" },
        { step: 3, name: "andijvie", amount: 300, unit: "gram" },
      ],
      toTaste: ["zout", "peper"],
      multiStep: ["aardappelen", "ui"],
      allowAppended: 0,
    },
    expectedConfidence: "trusted",
  },
];
