ALTER TABLE "exports" ADD COLUMN "revision" text;--> statement-breakpoint
UPDATE "exports" SET "revision" = 'R0' WHERE "revision" IS NULL;