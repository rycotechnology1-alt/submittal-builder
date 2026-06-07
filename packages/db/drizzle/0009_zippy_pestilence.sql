ALTER TABLE "saved_item_files" ADD COLUMN "processing_status" "pdf_processing_status" DEFAULT 'extracted' NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_item_files" ADD COLUMN "processing_error" text;--> statement-breakpoint
CREATE INDEX "saved_item_files_workspace_status_idx" ON "saved_item_files" USING btree ("workspace_id","processing_status");
