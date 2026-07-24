// Phase 27 (COOK-01) W1 — five realistic norish recipes, the shared eval material
// for BOTH the pure serializer suite (this package) and the round-trip suite
// against the real WASM parser (`@norish/shared-server/__tests__/cooklang`).
// -----------------------------------------------------------------------------
// Ported verbatim from `.planning/phases/27-cooklang/spike/fixtures.ts`. No recipe
// fixtures/seed data exist in the repo (only seed-config.ts), so these are
// hand-constructed to match REAL norish shape: a flat `steps` list + a SEPARATE
// structured `ingredients` list with NO linkage (exactly what the DB holds today).
// Each recipe also carries the AFTER form: the per-step ingredient linkage the
// extraction pass produces. `expected` records, per step, the amounts that MUST
// survive the structured -> .cook -> parse round-trip. Ambiguities and the known
// lossy cases are annotated in `27-EXPERIMENT.md`.
// -----------------------------------------------------------------------------

import type { StructuredRecipe } from "@norish/shared/cooklang";

export type Fixture = {
  slug: string;
  // BEFORE: the two flat, unlinked lists that norish stores today.
  flatSteps: string[];
  flatIngredients: { name: string; amount?: number | string | null; unit?: string | null }[];
  // AFTER: the per-step ingredient linkage, as serializer input.
  recipe: StructuredRecipe;
  // per-step expected inline ingredients (name -> {amount, unit}) after round-trip
  expected: {
    stepText: string;
    ingredients: { name: string; amount: number | null; unit: string | null }[];
  }[];
};

// 1) PANCAKES — clean, one amount per ingredient, each named once. Best case.
const pancakes: Fixture = {
  slug: "pancakes",
  flatSteps: [
    "Whisk the flour, milk, egg and salt into a smooth batter.",
    "Heat a little butter in a frying pan over medium heat.",
    "Pour in a ladle of batter and cook for 2 minutes per side until golden.",
  ],
  flatIngredients: [
    { name: "flour", amount: 200, unit: "gram" },
    { name: "milk", amount: 300, unit: "milliliter" },
    { name: "egg", amount: 2, unit: null },
    { name: "salt", amount: null, unit: null },
    { name: "butter", amount: 15, unit: "gram" },
  ],
  recipe: {
    name: "Simple Pancakes",
    servings: 4,
    systemUsed: "metric",
    steps: [
      {
        text: "Whisk the flour, milk, egg and salt into a smooth batter.",
        order: 0,
        ingredients: [
          { name: "flour", amount: 200, unit: "gram" },
          { name: "milk", amount: 300, unit: "milliliter" },
          { name: "egg", amount: 2, unit: null },
          { name: "salt", amount: null, unit: null },
        ],
      },
      {
        text: "Heat a little butter in a frying pan over medium heat.",
        order: 1,
        ingredients: [{ name: "butter", amount: 15, unit: "gram" }],
      },
      {
        text: "Pour in a ladle of batter and cook for 2 minutes per side until golden.",
        order: 2,
        ingredients: [],
        timers: [{ amount: 2, unit: "minutes" }],
      },
    ],
  },
  expected: [
    {
      stepText: "Whisk the flour",
      ingredients: [
        { name: "flour", amount: 200, unit: "gram" },
        { name: "milk", amount: 300, unit: "milliliter" },
        { name: "egg", amount: 2, unit: null },
        { name: "salt", amount: null, unit: null },
      ],
    },
    { stepText: "Heat", ingredients: [{ name: "butter", amount: 15, unit: "gram" }] },
    { stepText: "Pour", ingredients: [] },
  ],
};

// 2) SPAGHETTI BOLOGNESE — onion+garlic used across two steps; "salt to taste";
//    parmesan is a garnish not named in any step (APPENDED failure mode).
const bolognese: Fixture = {
  slug: "bolognese",
  flatSteps: [
    "Finely chop the onion and garlic.",
    "Fry the onion and garlic in olive oil until soft, then add the minced beef and brown it.",
    "Stir in the chopped tomatoes and tomato paste, season with salt, and simmer for 30 minutes.",
    "Meanwhile cook the spaghetti in salted water until al dente.",
    "Serve topped with grated parmesan.",
  ],
  flatIngredients: [
    { name: "onion", amount: 1, unit: null },
    { name: "garlic", amount: 2, unit: "clove" },
    { name: "olive oil", amount: 2, unit: "tablespoon" },
    { name: "minced beef", amount: 500, unit: "gram" },
    { name: "chopped tomatoes", amount: 400, unit: "gram" },
    { name: "tomato paste", amount: 2, unit: "tablespoon" },
    { name: "salt", amount: null, unit: null },
    { name: "spaghetti", amount: 400, unit: "gram" },
    { name: "parmesan", amount: 50, unit: "gram" },
  ],
  recipe: {
    name: "Spaghetti Bolognese",
    servings: 4,
    cookMinutes: 45,
    systemUsed: "metric",
    steps: [
      {
        text: "Finely chop the onion and garlic.",
        order: 0,
        // AMBIGUITY: onion/garlic amounts belong here or step 1? Attached to first
        // mention (step 0). Not attached again in step 1 to avoid double-counting.
        ingredients: [
          { name: "onion", amount: 1, unit: null },
          { name: "garlic", amount: 2, unit: "clove" },
        ],
      },
      {
        text: "Fry the onion and garlic in olive oil until soft, then add the minced beef and brown it.",
        order: 1,
        ingredients: [
          { name: "olive oil", amount: 2, unit: "tablespoon" },
          { name: "minced beef", amount: 500, unit: "gram" },
        ],
      },
      {
        text: "Stir in the chopped tomatoes and tomato paste, season with salt, and simmer for 30 minutes.",
        order: 2,
        ingredients: [
          { name: "chopped tomatoes", amount: 400, unit: "gram" },
          { name: "tomato paste", amount: 2, unit: "tablespoon" },
          { name: "salt", amount: null, unit: null },
        ],
        timers: [{ amount: 30, unit: "minutes" }],
      },
      {
        text: "Meanwhile cook the spaghetti in salted water until al dente.",
        order: 3,
        ingredients: [{ name: "spaghetti", amount: 400, unit: "gram" }],
      },
      {
        // FAILURE MODE: parmesan garnish — not textually anchored to an amount, and
        // "grated parmesan" vs ingredient name "parmesan" -> matches substring.
        text: "Serve topped with grated parmesan.",
        order: 4,
        ingredients: [{ name: "parmesan", amount: 50, unit: "gram" }],
      },
    ],
  },
  expected: [
    {
      stepText: "chop the",
      ingredients: [
        { name: "onion", amount: 1, unit: null },
        { name: "garlic", amount: 2, unit: "clove" },
      ],
    },
    {
      stepText: "Fry the",
      ingredients: [
        { name: "olive oil", amount: 2, unit: "tablespoon" },
        { name: "minced beef", amount: 500, unit: "gram" },
      ],
    },
    {
      stepText: "Stir in",
      ingredients: [
        { name: "chopped tomatoes", amount: 400, unit: "gram" },
        { name: "tomato paste", amount: 2, unit: "tablespoon" },
        { name: "salt", amount: null, unit: null },
      ],
    },
    { stepText: "Meanwhile", ingredients: [{ name: "spaghetti", amount: 400, unit: "gram" }] },
    { stepText: "Serve", ingredients: [{ name: "parmesan", amount: 50, unit: "gram" }] },
  ],
};

// 3) GUACAMOLE — "salt to taste" (no amount), lime JUICE vs ingredient "lime",
//    cilantro garnish. Tests amount-less + name-mismatch.
const guacamole: Fixture = {
  slug: "guacamole",
  flatSteps: [
    "Mash the avocado in a bowl.",
    "Stir in the lime juice, red onion and chopped tomato.",
    "Season with salt to taste and garnish with cilantro.",
  ],
  flatIngredients: [
    { name: "avocado", amount: 3, unit: null },
    { name: "lime", amount: 1, unit: null },
    { name: "red onion", amount: 0.5, unit: null },
    { name: "tomato", amount: 1, unit: null },
    { name: "salt", amount: null, unit: null },
    { name: "cilantro", amount: 10, unit: "gram" },
  ],
  recipe: {
    name: "Guacamole",
    servings: 2,
    systemUsed: "metric",
    steps: [
      {
        text: "Mash the avocado in a bowl.",
        order: 0,
        ingredients: [{ name: "avocado", amount: 3, unit: null }],
      },
      {
        text: "Stir in the lime juice, red onion and chopped tomato.",
        order: 1,
        // NAME MISMATCH: ingredient is "lime" but text says "lime juice" — substring
        // match anchors "lime"; "tomato" appears as "chopped tomato".
        ingredients: [
          { name: "lime", amount: 1, unit: null },
          { name: "red onion", amount: 0.5, unit: null },
          { name: "tomato", amount: 1, unit: null },
        ],
      },
      {
        text: "Season with salt to taste and garnish with cilantro.",
        order: 2,
        ingredients: [
          { name: "salt", amount: null, unit: null },
          { name: "cilantro", amount: 10, unit: "gram" },
        ],
      },
    ],
  },
  expected: [
    { stepText: "Mash", ingredients: [{ name: "avocado", amount: 3, unit: null }] },
    {
      stepText: "Stir in",
      ingredients: [
        { name: "lime", amount: 1, unit: null },
        { name: "red onion", amount: 0.5, unit: null },
        { name: "tomato", amount: 1, unit: null },
      ],
    },
    {
      stepText: "Season",
      ingredients: [
        { name: "salt", amount: null, unit: null },
        { name: "cilantro", amount: 10, unit: "gram" },
      ],
    },
  ],
};

// 4) CHOCOLATE CHIP COOKIES — brown sugar vs sugar (longest-match!), egg split
//    conceptually across bind step, section heading.
const cookies: Fixture = {
  slug: "cookies",
  flatSteps: [
    "# Dough",
    "Cream the butter with the sugar and brown sugar until fluffy.",
    "Beat in the egg and vanilla.",
    "Fold in the flour, baking soda and chocolate chips.",
    "# Bake",
    "Bake at 180 for 12 minutes until golden at the edges.",
  ],
  flatIngredients: [
    { name: "butter", amount: 115, unit: "gram" },
    { name: "sugar", amount: 100, unit: "gram" },
    { name: "brown sugar", amount: 150, unit: "gram" },
    { name: "egg", amount: 1, unit: null },
    { name: "vanilla", amount: 1, unit: "teaspoon" },
    { name: "flour", amount: 250, unit: "gram" },
    { name: "baking soda", amount: 1, unit: "teaspoon" },
    { name: "chocolate chips", amount: 200, unit: "gram" },
  ],
  recipe: {
    name: "Chocolate Chip Cookies",
    servings: 24,
    prepMinutes: 15,
    cookMinutes: 12,
    systemUsed: "metric",
    steps: [
      { text: "# Dough", order: 0, ingredients: [] },
      {
        // AMBIGUITY: "sugar" is a substring of "brown sugar" — serializer sorts
        // longest-name-first so "brown sugar" is tokenised before "sugar".
        text: "Cream the butter with the sugar and brown sugar until fluffy.",
        order: 1,
        ingredients: [
          { name: "butter", amount: 115, unit: "gram" },
          { name: "sugar", amount: 100, unit: "gram" },
          { name: "brown sugar", amount: 150, unit: "gram" },
        ],
      },
      {
        text: "Beat in the egg and vanilla.",
        order: 2,
        ingredients: [
          { name: "egg", amount: 1, unit: null },
          { name: "vanilla", amount: 1, unit: "teaspoon" },
        ],
      },
      {
        text: "Fold in the flour, baking soda and chocolate chips.",
        order: 3,
        ingredients: [
          { name: "flour", amount: 250, unit: "gram" },
          { name: "baking soda", amount: 1, unit: "teaspoon" },
          { name: "chocolate chips", amount: 200, unit: "gram" },
        ],
      },
      { text: "# Bake", order: 4, ingredients: [] },
      {
        text: "Bake at 180 for 12 minutes until golden at the edges.",
        order: 5,
        ingredients: [],
        timers: [{ amount: 12, unit: "minutes" }],
      },
    ],
  },
  expected: [
    {
      stepText: "Cream",
      ingredients: [
        { name: "butter", amount: 115, unit: "gram" },
        { name: "sugar", amount: 100, unit: "gram" },
        { name: "brown sugar", amount: 150, unit: "gram" },
      ],
    },
    {
      stepText: "Beat",
      ingredients: [
        { name: "egg", amount: 1, unit: null },
        { name: "vanilla", amount: 1, unit: "teaspoon" },
      ],
    },
    {
      stepText: "Fold",
      ingredients: [
        { name: "flour", amount: 250, unit: "gram" },
        { name: "baking soda", amount: 1, unit: "teaspoon" },
        { name: "chocolate chips", amount: 200, unit: "gram" },
      ],
    },
    { stepText: "Bake", ingredients: [] },
  ],
};

// 5) THAI GREEN CURRY — coconut milk used across two steps (SPLIT amount), curry
//    paste (sub-recipe-ish, treated as one ingredient), basil garnish.
const curry: Fixture = {
  slug: "curry",
  flatSteps: [
    "Fry the green curry paste in a little of the coconut milk until fragrant.",
    "Add the chicken and brown, then pour in the rest of the coconut milk and the fish sauce.",
    "Add the bamboo shoots and simmer for 15 minutes.",
    "Finish with Thai basil and serve with rice.",
  ],
  flatIngredients: [
    { name: "green curry paste", amount: 3, unit: "tablespoon" },
    { name: "coconut milk", amount: 400, unit: "milliliter" },
    { name: "chicken", amount: 500, unit: "gram" },
    { name: "fish sauce", amount: 1, unit: "tablespoon" },
    { name: "bamboo shoots", amount: 200, unit: "gram" },
    { name: "Thai basil", amount: 15, unit: "gram" },
    { name: "rice", amount: 300, unit: "gram" },
  ],
  recipe: {
    name: "Thai Green Curry",
    servings: 4,
    cookMinutes: 25,
    systemUsed: "metric",
    steps: [
      {
        // SPLIT AMOUNT: coconut milk (400ml total) is used in BOTH step 0 and step 1.
        // Total lives in the structured list; here the whole 400ml is attached to
        // the SECOND (main) use and step 0 gets a note-only bare @coconut milk{}.
        text: "Fry the green curry paste in a little of the coconut milk until fragrant.",
        order: 0,
        ingredients: [
          { name: "green curry paste", amount: 3, unit: "tablespoon" },
          { name: "coconut milk", amount: null, unit: null },
        ],
      },
      {
        text: "Add the chicken and brown, then pour in the rest of the coconut milk and the fish sauce.",
        order: 1,
        ingredients: [
          { name: "chicken", amount: 500, unit: "gram" },
          { name: "coconut milk", amount: 400, unit: "milliliter" },
          { name: "fish sauce", amount: 1, unit: "tablespoon" },
        ],
      },
      {
        text: "Add the bamboo shoots and simmer for 15 minutes.",
        order: 2,
        ingredients: [{ name: "bamboo shoots", amount: 200, unit: "gram" }],
        timers: [{ amount: 15, unit: "minutes" }],
      },
      {
        text: "Finish with Thai basil and serve with rice.",
        order: 3,
        ingredients: [
          { name: "Thai basil", amount: 15, unit: "gram" },
          { name: "rice", amount: 300, unit: "gram" },
        ],
      },
    ],
  },
  expected: [
    {
      stepText: "Fry",
      ingredients: [
        { name: "green curry paste", amount: 3, unit: "tablespoon" },
        { name: "coconut milk", amount: null, unit: null },
      ],
    },
    {
      stepText: "Add the chicken",
      ingredients: [
        { name: "chicken", amount: 500, unit: "gram" },
        { name: "coconut milk", amount: 400, unit: "milliliter" },
        { name: "fish sauce", amount: 1, unit: "tablespoon" },
      ],
    },
    { stepText: "bamboo", ingredients: [{ name: "bamboo shoots", amount: 200, unit: "gram" }] },
    {
      stepText: "Finish",
      ingredients: [
        { name: "Thai basil", amount: 15, unit: "gram" },
        { name: "rice", amount: 300, unit: "gram" },
      ],
    },
  ],
};

export const fixtures: Fixture[] = [pancakes, bolognese, guacamole, cookies, curry];
