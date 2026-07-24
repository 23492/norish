import { index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { ingredients } from "./ingredients";
import { measurementSystemEnum, recipes } from "./recipes";
import { versionColumn } from "./shared";

export const recipeIngredients = pgTable(
  "recipe_ingredients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipeId: uuid("recipe_id")
      .notNull()
      .references(() => recipes.id, { onDelete: "cascade" }),
    ingredientId: uuid("ingredient_id")
      .notNull()
      .references(() => ingredients.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 10, scale: 3 }),
    unit: text("unit"),
    order: numeric("order"),
    systemUsed: measurementSystemEnum("system_used").notNull().default("metric"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
  },
  (t) => [
    index("idx_recipe_ingredients_recipe_id").on(t.recipeId),
    index("idx_recipe_ingredients_ingredient_id").on(t.ingredientId),
    // Phase 27 (COOK-01, `0041`) — the NATURAL KEY of the derived projection.
    // `deriveProjectionTx` UPSERTs on it instead of delete-and-reinsert, so a
    // `recipe_ingredients.id` survives a recipe edit and every
    // `groceries.recipe_ingredient_id` FK stays intact (§2.5, the Phase 25 lesson).
    // `system_used` is NOT NULL, so Postgres NULL-distinctness cannot weaken it.
    uniqueIndex("uq_recipe_ingredients_recipe_system_ingredient").on(
      t.recipeId,
      t.systemUsed,
      t.ingredientId
    ),
  ]
);
