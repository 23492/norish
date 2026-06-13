ALTER TABLE "households" ADD COLUMN "invite_token" text;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "uq_households_invite_token" UNIQUE("invite_token");