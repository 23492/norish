import type { IFuseOptions } from "fuse.js";
import { and, eq, sql } from "drizzle-orm";
import Fuse from "fuse.js";
import z from "zod";

import type {
  IngredientStorePreferenceDto,
  StoreDto,
  StoreInsertDto,
  StoreUpdateDto,
} from "@norish/shared/contracts/dto/stores";
import { db } from "@norish/db/drizzle";
import { groceries, ingredientStorePreferences, stores } from "@norish/db/schema";
import {
  IngredientStorePreferenceInsertSchema,
  IngredientStorePreferenceSelectSchema,
  StoreInsertBaseSchema,
  StoreSelectBaseSchema,
  StoreUpdateBaseSchema,
} from "@norish/shared/contracts/zod";

// Fuse.js configuration for ingredient name fuzzy matching
// threshold: 0 = exact match, 1 = match anything
// 0.4 is a good balance for ingredient names like "milk" matching "whole milk"
const FUZZY_THRESHOLD = 0.4;

const FUSE_OPTIONS: IFuseOptions<IngredientStorePreferenceDto> = {
  keys: ["normalizedName"],
  threshold: FUZZY_THRESHOLD,
  minMatchCharLength: 2,
  ignoreLocation: true,
  ignoreFieldNorm: true, // Critical for short strings like ingredient names
  includeScore: true,
  shouldSort: true,
};

export async function getStoreById(id: string): Promise<StoreDto | null> {
  const [row] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);

  if (!row) return null;

  const parsed = StoreSelectBaseSchema.safeParse(row);

  if (!parsed.success) throw new Error("Failed to parse store by id");

  return parsed.data;
}

/**
 * SHOP-02: list a household's stores (aisles), ordered. Scopes on
 * `stores.household_id` — the isolation boundary (HOUSE-06).
 */
export async function listStoresByHousehold(householdId: string): Promise<StoreDto[]> {
  if (!householdId) return [];

  const rows = await db
    .select()
    .from(stores)
    .where(eq(stores.householdId, householdId))
    .orderBy(stores.sortOrder);

  const parsed = z.array(StoreSelectBaseSchema).safeParse(rows);

  if (!parsed.success) throw new Error("Failed to parse stores");

  return parsed.data;
}

export async function checkStoreNameExistsInHousehold(
  name: string,
  householdId: string,
  excludeStoreId?: string
): Promise<boolean> {
  if (!householdId) return false;

  const normalizedName = name.toLowerCase().trim();

  const conditions = [
    eq(stores.householdId, householdId),
    sql`LOWER(TRIM(${stores.name})) = ${normalizedName}`,
  ];

  if (excludeStoreId) {
    conditions.push(sql`${stores.id} != ${excludeStoreId}`);
  }

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(stores)
    .where(and(...conditions));

  return (row?.count ?? 0) > 0;
}

export async function createStore(id: string, input: StoreInsertDto): Promise<StoreDto> {
  const parsed = StoreInsertBaseSchema.safeParse(input);

  if (!parsed.success) throw new Error("Invalid StoreInsertDto");

  // Get max sort order for the household's stores
  const [maxOrder] = await db
    .select({ max: sql<number>`COALESCE(MAX(${stores.sortOrder}), -1)` })
    .from(stores)
    .where(eq(stores.householdId, input.householdId));

  const sortOrder = (maxOrder?.max ?? -1) + 1;

  const [row] = await db
    .insert(stores)
    .values({ id, ...parsed.data, sortOrder })
    .returning();

  const validated = StoreSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to parse created store");

  return validated.data;
}

export async function updateStore(input: StoreUpdateDto): Promise<StoreDto | null> {
  const parsed = StoreUpdateBaseSchema.safeParse(input);

  if (!parsed.success) throw new Error("Invalid StoreUpdateDto");

  const whereConditions = [eq(stores.id, input.id)];

  if (parsed.data.version) {
    whereConditions.push(eq(stores.version, parsed.data.version));
  }

  const [row] = await db
    .update(stores)
    .set({ ...parsed.data, updatedAt: new Date(), version: sql`${stores.version} + 1` })
    .where(and(...whereConditions))
    .returning();

  if (!row) return null;

  const validated = StoreSelectBaseSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to parse updated store");

  return validated.data;
}

export async function reorderStores(
  storeUpdates: { id: string; version: number }[]
): Promise<StoreDto[]> {
  return await db.transaction(async (trx) => {
    const updatedStores: StoreDto[] = [];

    for (let i = 0; i < storeUpdates.length; i++) {
      const storeUpdate = storeUpdates[i];

      if (!storeUpdate) continue;

      const [row] = await trx
        .update(stores)
        .set({ sortOrder: i, updatedAt: new Date(), version: sql`${stores.version} + 1` })
        .where(and(eq(stores.id, storeUpdate.id), eq(stores.version, storeUpdate.version)))
        .returning();

      if (row) {
        const validated = StoreSelectBaseSchema.safeParse(row);

        if (!validated.success)
          throw new Error(`Failed to parse reordered store (id=${storeUpdate.id})`);
        updatedStores.push(validated.data);
      }
    }

    return updatedStores;
  });
}

export async function deleteStore(
  storeId: string,
  version: number,
  deleteGroceries: boolean,
  grocerySnapshot?: Array<{ id: string; version: number }>
): Promise<{ deletedGroceryIds: string[]; storeDeleted: boolean; stale: boolean }> {
  return await db.transaction(async (trx) => {
    let deletedGroceryIds: string[] = [];

    const [storeRow] = await trx
      .select({ id: stores.id })
      .from(stores)
      .where(and(eq(stores.id, storeId), eq(stores.version, version)))
      .limit(1);

    if (!storeRow) {
      return { deletedGroceryIds, storeDeleted: false, stale: true };
    }

    if (grocerySnapshot && grocerySnapshot.length > 0) {
      if (deleteGroceries) {
        for (const grocery of grocerySnapshot) {
          const deleted = await trx
            .delete(groceries)
            .where(
              and(
                eq(groceries.id, grocery.id),
                eq(groceries.version, grocery.version),
                eq(groceries.storeId, storeId)
              )
            )
            .returning({ id: groceries.id });

          if (deleted.length > 0) {
            deletedGroceryIds.push(grocery.id);
          }
        }
      } else {
        for (const grocery of grocerySnapshot) {
          await trx
            .update(groceries)
            .set({ storeId: null, updatedAt: new Date(), version: sql`${groceries.version} + 1` })
            .where(
              and(
                eq(groceries.id, grocery.id),
                eq(groceries.version, grocery.version),
                eq(groceries.storeId, storeId)
              )
            );
        }
      }

      // Only delete store if it is empty after processing the snapshot
      const [remainingCount] = await trx
        .select({ count: sql<number>`count(*)` })
        .from(groceries)
        .where(eq(groceries.storeId, storeId));

      const isEmpty = (remainingCount?.count ?? 0) === 0;

      if (isEmpty) {
        // Delete ingredient preferences for this store
        await trx
          .delete(ingredientStorePreferences)
          .where(eq(ingredientStorePreferences.storeId, storeId));

        // Delete the store
        const deletedStore = await trx
          .delete(stores)
          .where(and(eq(stores.id, storeId), eq(stores.version, version)))
          .returning({ id: stores.id });

        if (deletedStore.length === 0) {
          return { deletedGroceryIds, storeDeleted: false, stale: true };
        }
      }

      return { deletedGroceryIds, storeDeleted: isEmpty, stale: false };
    }

    // Legacy path (no snapshot): process all current groceries
    if (deleteGroceries) {
      // Get grocery IDs before deleting
      const groceryRows = await trx
        .select({ id: groceries.id })
        .from(groceries)
        .where(eq(groceries.storeId, storeId));

      deletedGroceryIds = groceryRows.map((g) => g.id);

      // Delete groceries
      await trx.delete(groceries).where(eq(groceries.storeId, storeId));
    } else {
      // Set storeId to null for groceries in this store
      await trx
        .update(groceries)
        .set({ storeId: null, updatedAt: new Date(), version: sql`${groceries.version} + 1` })
        .where(eq(groceries.storeId, storeId));
    }

    // Delete ingredient preferences for this store
    await trx
      .delete(ingredientStorePreferences)
      .where(eq(ingredientStorePreferences.storeId, storeId));

    // Delete the store
    const deletedStore = await trx
      .delete(stores)
      .where(and(eq(stores.id, storeId), eq(stores.version, version)))
      .returning({ id: stores.id });

    if (deletedStore.length === 0) {
      return { deletedGroceryIds, storeDeleted: false, stale: true };
    }

    return { deletedGroceryIds, storeDeleted: true, stale: false };
  });
}

export async function getStoreOwnerId(storeId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: stores.userId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  return row?.userId ?? null;
}

/**
 * SHOP-02 / HOUSE-06: the owning household id for a store (isolation gate).
 */
export async function getStoreHouseholdId(storeId: string): Promise<string | null> {
  const [row] = await db
    .select({ householdId: stores.householdId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  return row?.householdId ?? null;
}

export async function countGroceriesInStore(storeId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(groceries)
    .where(eq(groceries.storeId, storeId));

  return row?.count ?? 0;
}

export async function getIngredientStorePreference(
  householdId: string,
  normalizedName: string
): Promise<IngredientStorePreferenceDto | null> {
  const [row] = await db
    .select()
    .from(ingredientStorePreferences)
    .where(
      and(
        eq(ingredientStorePreferences.householdId, householdId),
        eq(ingredientStorePreferences.normalizedName, normalizedName)
      )
    )
    .limit(1);

  if (!row) return null;

  const parsed = IngredientStorePreferenceSelectSchema.safeParse(row);

  if (!parsed.success) throw new Error("Failed to parse ingredient store preference");

  return parsed.data;
}

/**
 * SHOP-02: all aisle preferences for a household (the shared mapping).
 */
export async function listIngredientStorePreferencesByHousehold(
  householdId: string
): Promise<IngredientStorePreferenceDto[]> {
  if (!householdId) return [];

  const rows = await db
    .select()
    .from(ingredientStorePreferences)
    .where(eq(ingredientStorePreferences.householdId, householdId));

  const parsed = z.array(IngredientStorePreferenceSelectSchema).safeParse(rows);

  if (!parsed.success) throw new Error("Failed to parse ingredient store preferences");

  return parsed.data;
}

export async function upsertIngredientStorePreference(
  householdId: string,
  userId: string,
  normalizedName: string,
  storeId: string
): Promise<IngredientStorePreferenceDto> {
  const input = { householdId, userId, normalizedName, storeId };
  const parsed = IngredientStorePreferenceInsertSchema.safeParse(input);

  if (!parsed.success) throw new Error("Invalid IngredientStorePreferenceInsertDto");

  const [row] = await db
    .insert(ingredientStorePreferences)
    .values(parsed.data)
    .onConflictDoUpdate({
      target: [ingredientStorePreferences.householdId, ingredientStorePreferences.normalizedName],
      set: {
        storeId,
        userId,
        updatedAt: new Date(),
        version: sql`${ingredientStorePreferences.version} + 1`,
      },
    })
    .returning();

  const validated = IngredientStorePreferenceSelectSchema.safeParse(row);

  if (!validated.success) throw new Error("Failed to parse upserted ingredient store preference");

  return validated.data;
}

export async function deleteIngredientStorePreference(
  householdId: string,
  normalizedName: string
): Promise<void> {
  await db
    .delete(ingredientStorePreferences)
    .where(
      and(
        eq(ingredientStorePreferences.householdId, householdId),
        eq(ingredientStorePreferences.normalizedName, normalizedName)
      )
    );
}

/**
 * Normalize an ingredient name for store preference matching
 */
export function normalizeIngredientName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Result type for fuzzy preference matching
 */
export interface FuzzyPreferenceMatch {
  preference: IngredientStorePreferenceDto;
  score: number; // 0 = perfect match, higher = worse match
  isExactMatch: boolean;
}

/**
 * SHOP-02: find the best matching aisle preference within a HOUSEHOLD.
 * The mapping is now household-shared, so there is a single pool of
 * preferences (no per-user priority). Exact match wins; otherwise the best
 * fuzzy match above threshold.
 *
 * @param householdId - The caller's active shopping household
 * @param searchName - The ingredient name to search for (will be normalized)
 * @returns The best matching preference or null if no match above threshold
 */
export async function findBestIngredientStorePreference(
  householdId: string,
  searchName: string
): Promise<FuzzyPreferenceMatch | null> {
  if (!householdId || !searchName.trim()) return null;

  const normalizedSearch = normalizeIngredientName(searchName);

  const allPreferences = await listIngredientStorePreferencesByHousehold(householdId);

  if (allPreferences.length === 0) return null;

  // Step 1: exact match wins.
  const exact = allPreferences.find((p) => p.normalizedName === normalizedSearch);

  if (exact) {
    return { preference: exact, score: 0, isExactMatch: true };
  }

  // Step 2: fuzzy match.
  const fuse = new Fuse(allPreferences, FUSE_OPTIONS);
  const results = fuse.search(normalizedSearch);
  const best = results[0];

  if (!best) return null;

  return { preference: best.item, score: best.score ?? 1, isExactMatch: false };
}

/**
 * SHOP-01: built-in default aisle set. A fresh household is seeded with these
 * ordered aisles (as `stores`) plus a curated ingredient->aisle mapping (as
 * `ingredient_store_preferences`) so the shopping list is grouped the way a
 * shop is walked with ZERO configuration. Keywords cover common EN + NL
 * ingredients (normalized: lowercased, trimmed). Decision D-25-04: a curated
 * built-in default rather than importing the full open-tandoor-data dataset.
 * The migration `0040` seeds the SAME set into existing store-less households;
 * keep the two in sync.
 */
export const DEFAULT_AISLES: ReadonlyArray<{
  name: string;
  color: string;
  ingredients: readonly string[];
}> = [
  {
    name: "Produce",
    color: "success",
    ingredients: [
      "apple", "appel", "banana", "banaan", "tomato", "tomaat", "tomaten", "potato",
      "aardappel", "aardappelen", "onion", "ui", "uien", "garlic", "knoflook", "carrot",
      "wortel", "wortels", "lettuce", "sla", "cucumber", "komkommer", "bell pepper", "paprika",
      "spinach", "spinazie", "mushroom", "champignon", "champignons", "lemon", "citroen",
      "lime", "limoen", "avocado", "broccoli", "courgette", "zucchini", "bell peppers",
    ],
  },
  {
    name: "Bakery",
    color: "warning",
    ingredients: [
      "bread", "brood", "baguette", "stokbrood", "croissant", "bun", "buns", "broodje",
      "broodjes", "bagel", "tortilla", "wrap", "wraps", "roll", "rolls", "pita",
    ],
  },
  {
    name: "Dairy & Eggs",
    color: "sky",
    ingredients: [
      "milk", "melk", "cheese", "kaas", "butter", "boter", "egg", "eggs", "ei", "eieren",
      "yogurt", "yoghurt", "cream", "room", "slagroom", "quark", "kwark", "mozzarella",
      "feta", "creme fraiche",
    ],
  },
  {
    name: "Meat & Fish",
    color: "danger",
    ingredients: [
      "chicken", "kip", "beef", "rundvlees", "pork", "varkensvlees", "mince", "gehakt",
      "bacon", "spek", "sausage", "worst", "ham", "salmon", "zalm", "tuna", "tonijn",
      "shrimp", "garnalen", "fish", "vis", "kipfilet", "chicken breast",
    ],
  },
  {
    name: "Pantry",
    color: "secondary",
    ingredients: [
      "rice", "rijst", "pasta", "spaghetti", "flour", "bloem", "sugar", "suiker", "salt",
      "zout", "oil", "olie", "olive oil", "olijfolie", "vinegar", "azijn", "beans", "bonen",
      "lentils", "linzen", "canned tomatoes", "tomatenblokjes", "stock", "bouillon", "honey",
      "honing", "peanut butter", "pindakaas", "pepper", "peper", "chickpeas", "kikkererwten",
    ],
  },
  {
    name: "Frozen",
    color: "primary",
    ingredients: [
      "ice cream", "ijs", "frozen pizza", "diepvriespizza", "frozen vegetables",
      "diepvriesgroenten", "fries", "frietjes", "patat", "frozen peas", "doperwten",
    ],
  },
  {
    name: "Drinks",
    color: "violet",
    ingredients: [
      "water", "juice", "sap", "sinaasappelsap", "coffee", "koffie", "tea", "thee", "soda",
      "cola", "beer", "bier", "wine", "wijn", "orange juice",
    ],
  },
  {
    name: "Household",
    color: "slate",
    ingredients: [
      "toilet paper", "wc papier", "toiletpapier", "dish soap", "afwasmiddel", "detergent",
      "wasmiddel", "kitchen roll", "keukenrol", "cleaner", "schoonmaakmiddel", "sponge",
      "spons", "trash bags", "vuilniszakken", "aluminum foil", "aluminiumfolie",
    ],
  },
];

/**
 * SHOP-01: seed the built-in default aisles + ingredient mapping for a
 * household. Idempotent: skips entirely if the household already has ANY store
 * (so it never disturbs a household that already configured its own aisles).
 * `userId` is written to the added-by/audit `user_id` column.
 */
export async function seedDefaultAislesForHousehold(
  householdId: string,
  userId: string
): Promise<void> {
  if (!householdId || !userId) return;

  await db.transaction(async (trx) => {
    const [existing] = await trx
      .select({ count: sql<number>`count(*)` })
      .from(stores)
      .where(eq(stores.householdId, householdId));

    if ((existing?.count ?? 0) > 0) return;

    const storeRows = DEFAULT_AISLES.map((aisle, index) => ({
      id: crypto.randomUUID(),
      householdId,
      userId,
      name: aisle.name,
      color: aisle.color,
      icon: "ShoppingBagIcon",
      sortOrder: index,
    }));

    await trx.insert(stores).values(storeRows);

    const prefRows: Array<{
      householdId: string;
      userId: string;
      normalizedName: string;
      storeId: string;
    }> = [];
    const seen = new Set<string>();

    DEFAULT_AISLES.forEach((aisle, index) => {
      const storeId = storeRows[index]!.id;

      for (const ingredient of aisle.ingredients) {
        const normalizedName = normalizeIngredientName(ingredient);

        if (!normalizedName || seen.has(normalizedName)) continue;
        seen.add(normalizedName);
        prefRows.push({ householdId, userId, normalizedName, storeId });
      }
    });

    if (prefRows.length > 0) {
      await trx.insert(ingredientStorePreferences).values(prefRows);
    }
  });
}
