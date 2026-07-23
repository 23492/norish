import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { households } from "./households";
import { versionColumn } from "./shared";

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // SHOP-02: stores (aisles) are HOUSEHOLD-scoped. `user_id` is added-by/audit only.
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("primary"),
    icon: text("icon").notNull().default("ShoppingBagIcon"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
  },
  (t) => [
    index("idx_stores_household_id").on(t.householdId),
    index("idx_stores_user_id").on(t.userId),
    index("idx_stores_sort_order").on(t.sortOrder),
  ]
);

export const ingredientStorePreferences = pgTable(
  "ingredient_store_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // SHOP-02: aisle mapping is HOUSEHOLD-scoped (unique per household + name).
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    normalizedName: text("normalized_name").notNull(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
  },
  (t) => [
    index("idx_ingredient_store_prefs_household_id").on(t.householdId),
    index("idx_ingredient_store_prefs_user_id").on(t.userId),
    index("idx_ingredient_store_prefs_store_id").on(t.storeId),
    unique("uq_ingredient_store_prefs_household_name").on(t.householdId, t.normalizedName),
  ]
);
