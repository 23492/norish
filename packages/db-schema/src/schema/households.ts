import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { versionColumn } from "./shared";

/**
 * Per-cookbook permission level. Reuses the SAME three values as the global
 * `RecipePermissionPolicySchema` / `PermissionLevelSchema` (config zod) so the
 * per-household policy columns and the server-wide default can never drift.
 */
export const permissionLevel = pgEnum("permission_level", ["everyone", "household", "owner"]);

export const households = pgTable(
  "households",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    adminUserId: text("admin_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinCode: text("join_code"),
    joinCodeExpiresAt: timestamp("join_code_expires_at", { withTimezone: true }),
    inviteToken: text("invite_token"),
    // Per-cookbook recipe permission policy. Defaults mirror
    // DEFAULT_RECIPE_PERMISSION_POLICY (everyone/household/household); the global
    // server-wide policy is applied as the default for NEW cookbooks at create
    // time (and remains the fallback for personal, household-less recipes).
    viewPolicy: permissionLevel("view_policy").notNull().default("everyone"),
    editPolicy: permissionLevel("edit_policy").notNull().default("household"),
    deletePolicy: permissionLevel("delete_policy").notNull().default("household"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ...versionColumn,
  },
  (t) => [
    index("idx_households_name").on(t.name),
    index("idx_households_created_at").on(t.createdAt),
    index("idx_households_admin_user_id").on(t.adminUserId),
    unique("uq_households_join_code").on(t.joinCode),
    unique("uq_households_invite_token").on(t.inviteToken),
  ]
);
