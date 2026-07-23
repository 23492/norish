-- SHOP-02: re-key the shopping list from per-USER to per-HOUSEHOLD ownership.
--
-- `groceries`, `stores`, `ingredient_store_preferences` and `recurring_groceries`
-- gain a `household_id` — the new ownership/isolation key (HOUSE-06). `user_id`
-- is RETAINED as an added-by/audit column (non-destructive).
--
-- EXISTING-ROW REMAP (D-25-01): each row's `household_id` = the row's user's OWN
-- household = the earliest household they ADMIN (their signup household), falling
-- back to their earliest MEMBERSHIP. This mapping is injective per user
-- (`admin_user_id` is unique per household row), so NO two users' rows are merged
-- into one household and the per-household unique constraint below can never
-- collide. Rows keep their data; nothing is deleted.
--
-- Dry-run: verified against a RESTORE of the live backup into a scratch DB
-- (row counts preserved, 0 NULL household_id after backfill, unique holds).

-- 1. Add the nullable column (backfilled below, then set NOT NULL).
ALTER TABLE "groceries" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "ingredient_store_preferences" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_groceries" ADD COLUMN "household_id" uuid;--> statement-breakpoint

-- 2a. Backfill from the user's OWN (earliest-admin) household.
UPDATE "groceries" AS g SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  WHERE h."admin_user_id" = g."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE g."household_id" IS NULL;--> statement-breakpoint
UPDATE "stores" AS s SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  WHERE h."admin_user_id" = s."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE s."household_id" IS NULL;--> statement-breakpoint
UPDATE "ingredient_store_preferences" AS p SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  WHERE h."admin_user_id" = p."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE p."household_id" IS NULL;--> statement-breakpoint
UPDATE "recurring_groceries" AS r SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  WHERE h."admin_user_id" = r."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE r."household_id" IS NULL;--> statement-breakpoint

-- 2b. Fallback for users who admin NO household: earliest household they belong to.
UPDATE "groceries" AS g SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  JOIN "household_users" AS hu ON hu."household_id" = h."id"
  WHERE hu."user_id" = g."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE g."household_id" IS NULL;--> statement-breakpoint
UPDATE "stores" AS s SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  JOIN "household_users" AS hu ON hu."household_id" = h."id"
  WHERE hu."user_id" = s."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE s."household_id" IS NULL;--> statement-breakpoint
UPDATE "ingredient_store_preferences" AS p SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  JOIN "household_users" AS hu ON hu."household_id" = h."id"
  WHERE hu."user_id" = p."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE p."household_id" IS NULL;--> statement-breakpoint
UPDATE "recurring_groceries" AS r SET "household_id" = (
  SELECT h."id" FROM "households" AS h
  JOIN "household_users" AS hu ON hu."household_id" = h."id"
  WHERE hu."user_id" = r."user_id"
  ORDER BY h."created_at" ASC LIMIT 1
) WHERE r."household_id" IS NULL;--> statement-breakpoint

-- 3. Drop the per-USER unique on the aisle mapping and dedupe any (household,name)
--    collisions defensively (keep the most-recently-updated row) before the new
--    per-HOUSEHOLD unique. By construction (injective user->household) there are
--    none, but a re-key must never fail on a stale duplicate.
ALTER TABLE "ingredient_store_preferences" DROP CONSTRAINT IF EXISTS "uq_ingredient_store_prefs_user_name";--> statement-breakpoint
DELETE FROM "ingredient_store_preferences" AS p
USING "ingredient_store_preferences" AS q
WHERE p."household_id" = q."household_id"
  AND p."normalized_name" = q."normalized_name"
  AND (p."updated_at" < q."updated_at" OR (p."updated_at" = q."updated_at" AND p."id" < q."id"));--> statement-breakpoint

-- 4. Enforce NOT NULL + FK + indexes now that every row carries a household_id.
ALTER TABLE "groceries" ALTER COLUMN "household_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "household_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ingredient_store_preferences" ALTER COLUMN "household_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_groceries" ALTER COLUMN "household_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "groceries" ADD CONSTRAINT "groceries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_store_preferences" ADD CONSTRAINT "ingredient_store_preferences_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_groceries" ADD CONSTRAINT "recurring_groceries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_groceries_household_id" ON "groceries" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_stores_household_id" ON "stores" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_ingredient_store_prefs_household_id" ON "ingredient_store_preferences" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_groceries_household_id" ON "recurring_groceries" USING btree ("household_id");--> statement-breakpoint

ALTER TABLE "ingredient_store_preferences" ADD CONSTRAINT "uq_ingredient_store_prefs_household_name" UNIQUE("household_id","normalized_name");

-- SHOP-01: seed the built-in default aisles + ingredient->aisle mapping into
-- EXISTING households that have NO stores yet, so their shopping list is grouped
-- out of the box (same curated set as `seedDefaultAislesForHousehold`; new
-- households are seeded by that function at create time). Idempotent: households
-- that already have stores are skipped.
CREATE TEMP TABLE _seed_aisles (sort_order int, name text, color text, ingredients text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (0, 'Produce', 'success', ARRAY['apple','appel','banana','banaan','tomato','tomaat','tomaten','potato','aardappel','aardappelen','onion','ui','uien','garlic','knoflook','carrot','wortel','wortels','lettuce','sla','cucumber','komkommer','bell pepper','paprika','spinach','spinazie','mushroom','champignon','champignons','lemon','citroen','lime','limoen','avocado','broccoli','courgette','zucchini','bell peppers']::text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (1, 'Bakery', 'warning', ARRAY['bread','brood','baguette','stokbrood','croissant','bun','buns','broodje','broodjes','bagel','tortilla','wrap','wraps','roll','rolls','pita']::text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (2, 'Dairy & Eggs', 'sky', ARRAY['milk','melk','cheese','kaas','butter','boter','egg','eggs','ei','eieren','yogurt','yoghurt','cream','room','slagroom','quark','kwark','mozzarella','feta','creme fraiche']::text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (3, 'Meat & Fish', 'danger', ARRAY['chicken','kip','beef','rundvlees','pork','varkensvlees','mince','gehakt','bacon','spek','sausage','worst','ham','salmon','zalm','tuna','tonijn','shrimp','garnalen','fish','vis','kipfilet','chicken breast']::text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (4, 'Pantry', 'secondary', ARRAY['rice','rijst','pasta','spaghetti','flour','bloem','sugar','suiker','salt','zout','oil','olie','olive oil','olijfolie','vinegar','azijn','beans','bonen','lentils','linzen','canned tomatoes','tomatenblokjes','stock','bouillon','honey','honing','peanut butter','pindakaas','pepper','peper','chickpeas','kikkererwten']::text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (5, 'Frozen', 'primary', ARRAY['ice cream','ijs','frozen pizza','diepvriespizza','frozen vegetables','diepvriesgroenten','fries','frietjes','patat','frozen peas','doperwten']::text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (6, 'Drinks', 'violet', ARRAY['water','juice','sap','sinaasappelsap','coffee','koffie','tea','thee','soda','cola','beer','bier','wine','wijn','orange juice']::text[]);--> statement-breakpoint
INSERT INTO _seed_aisles VALUES (7, 'Household', 'slate', ARRAY['toilet paper','wc papier','toiletpapier','dish soap','afwasmiddel','detergent','wasmiddel','kitchen roll','keukenrol','cleaner','schoonmaakmiddel','sponge','spons','trash bags','vuilniszakken','aluminum foil','aluminiumfolie']::text[]);--> statement-breakpoint
DO $$
DECLARE
  hh RECORD;
  a RECORD;
  sid uuid;
  ing text;
BEGIN
  FOR hh IN SELECT id, admin_user_id FROM households LOOP
    IF EXISTS (SELECT 1 FROM stores WHERE household_id = hh.id) THEN
      CONTINUE;
    END IF;
    FOR a IN SELECT * FROM _seed_aisles ORDER BY sort_order LOOP
      sid := gen_random_uuid();
      INSERT INTO stores (id, household_id, user_id, name, color, icon, sort_order)
      VALUES (sid, hh.id, hh.admin_user_id, a.name, a.color, 'ShoppingBagIcon', a.sort_order);
      FOREACH ing IN ARRAY a.ingredients LOOP
        INSERT INTO ingredient_store_preferences (household_id, user_id, normalized_name, store_id)
        VALUES (hh.id, hh.admin_user_id, ing, sid)
        ON CONFLICT (household_id, normalized_name) DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint
DROP TABLE _seed_aisles;
