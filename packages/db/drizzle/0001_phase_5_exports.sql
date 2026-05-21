CREATE TYPE "public"."export_status" AS ENUM('pending', 'rendering', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."job_kind" ADD VALUE 'render_export';--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "status" "export_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "exports" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "exports_package_created_idx" ON "exports" USING btree ("package_id","created_at");