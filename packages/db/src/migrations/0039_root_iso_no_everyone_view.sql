-- ROOT-ISO-01: stop cookbooks being born with `view_policy = 'everyone'`.
--
-- `setHouseholdPolicy` has rejected a per-cookbook view=everyone since Phase 3
-- (decision #5), but `createHousehold` inherited the server-wide default, so every
-- cookbook was created holding a value the setter would refuse. That single fact is the
-- origin of REALTIME-ISO-01, IMPORT-DEDUP-ISO-01, LIST-ISO-01, VIEW-ISO-01 and
-- TAGS-ISO-01.
--
-- edit/delete are deliberately untouched: `everyone` is not disallowed there by
-- decision #5, and no live row uses it.
ALTER TABLE "households" ALTER COLUMN "view_policy" SET DEFAULT 'household';--> statement-breakpoint
UPDATE "households" SET "view_policy" = 'household' WHERE "view_policy" = 'everyone';--> statement-breakpoint
-- The server-wide policy row seeds new cookbooks and is the fallback for personal
-- (household-less) recipes, so it has to move too or the next cookbook inherits the leak.
UPDATE "server_config"
SET "value" = jsonb_set("value", '{view}', '"household"')
WHERE "key" = 'recipe_permission_policy'
  AND "value" ->> 'view' = 'everyone';
