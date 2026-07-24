import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { households } from "./households";
import { recipeCategoryEnum } from "./recipe-categories";
import { versionColumn } from "./shared";

export const measurementSystemEnum = pgEnum("measurement_system", ["metric", "us"]);
export const recipeVisibilityEnum = pgEnum("recipe_visibility", [
  "private",
  "household",
  "public",
]);

export const recipes = pgTable(
  "recipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    householdId: uuid("household_id").references(() => households.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    image: text("image"),
    url: text("url"),
    servings: integer("servings").notNull().default(1),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    totalMinutes: integer("total_minutes"),
    notes: text("notes"),
    systemUsed: measurementSystemEnum("system_used").notNull().default("metric"),
    visibility: recipeVisibilityEnum("visibility").notNull().default("private"),
    calories: integer("calories"),
    fat: numeric("fat", { precision: 6, scale: 2 }),
    carbs: numeric("carbs", { precision: 6, scale: 2 }),
    protein: numeric("protein", { precision: 6, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    categories: recipeCategoryEnum("categories").array().notNull().default([]),
    // Phase 27 (COOK-01) — the Cooklang source of truth (`0041`, EXPAND).
    // Nullable during expand: nothing produces a `.cook` before W3 and the
    // backfill is `0042`; NOT NULL is `0043`/W6. INVARIANT: a non-NULL
    // `cook_source` always parses cleanly (D-27-W2-04) — a source that does not
    // is never stored.
    cookSource: text("cook_source"),
    // 0..1 backfill confidence, populated by W5's gate. Nullable = never scored.
    cookConfidence: numeric("cook_confidence", { precision: 4, scale: 3 }),
    // Set by W5's review queue and by `0041`'s lossy ingredient merge.
    cookReviewNeeded: boolean("cook_review_needed").notNull().default(false),
    ...versionColumn,
  },
  (t) => [
    index("idx_recipes_user_id").on(t.userId),
    index("idx_recipes_household_id").on(t.householdId),
    index("idx_recipes_name").on(t.name),
    unique("uq_recipes_url_household").on(t.url, t.householdId),
    index("idx_recipes_created_at_desc").on(t.createdAt.desc()),
    index("idx_recipes_total_minutes").on(t.totalMinutes),
    index("idx_recipes_prep_minutes").on(t.prepMinutes),
    index("idx_recipes_cook_minutes").on(t.cookMinutes),
  ]
);
