ALTER TABLE "recipes" DROP CONSTRAINT "uq_recipes_url_user";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "active_household_id" uuid;--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "household_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_active_household_id_households_id_fk" FOREIGN KEY ("active_household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recipes_household_id" ON "recipes" USING btree ("household_id");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "uq_recipes_url_household" UNIQUE("url","household_id");