CREATE TYPE "public"."permission_level" AS ENUM('everyone', 'household', 'owner');--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "view_policy" "permission_level" DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "edit_policy" "permission_level" DEFAULT 'household' NOT NULL;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "delete_policy" "permission_level" DEFAULT 'household' NOT NULL;--> statement-breakpoint
-- Backfill: seed every EXISTING household's per-cookbook policy from the current
-- server-wide `recipe_permission_policy` (the value demoted to "default for new
-- cookbooks"). New rows are covered by the column DEFAULTs above; this UPDATE
-- carries forward any admin-customized global policy to pre-existing cookbooks.
-- A no-op when the config row is absent (no row -> the COALESCE keeps defaults).
UPDATE "households" SET
  "view_policy"   = COALESCE((SELECT "value"->>'view'   FROM "server_config" WHERE "key" = 'recipe_permission_policy'), "view_policy")::"permission_level",
  "edit_policy"   = COALESCE((SELECT "value"->>'edit'   FROM "server_config" WHERE "key" = 'recipe_permission_policy'), "edit_policy")::"permission_level",
  "delete_policy" = COALESCE((SELECT "value"->>'delete' FROM "server_config" WHERE "key" = 'recipe_permission_policy'), "delete_policy")::"permission_level";