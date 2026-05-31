ALTER TABLE "source_pdfs" ADD COLUMN "saved_item_file_id" uuid;
--> statement-breakpoint
CREATE TABLE "saved_item_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"byte_size" bigint,
	"sha256" text NOT NULL,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_item_source_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saved_item_file_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"ocr_text" text,
	"has_ocr" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"saved_item_file_id" uuid NOT NULL,
	"title" text NOT NULL,
	"doc_type" "item_doc_type" DEFAULT 'other' NOT NULL,
	"doc_type_confidence" double precision,
	"doc_type_original_ai_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_item_attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saved_item_id" uuid NOT NULL,
	"key" text NOT NULL,
	"current_value" text,
	"original_ai_value" text,
	"confidence" double precision,
	"saved_item_source_page_id" uuid,
	"edited_by_user_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_item_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saved_item_id" uuid NOT NULL,
	"saved_item_source_page_id" uuid,
	"part_number" text NOT NULL,
	"size" text NOT NULL,
	"secondary_dims" jsonb,
	"display_label" text NOT NULL,
	"part_number_verification" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default_for_size" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_item_files" ADD CONSTRAINT "saved_item_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_item_source_pages" ADD CONSTRAINT "saved_item_source_pages_file_id_fk" FOREIGN KEY ("saved_item_file_id") REFERENCES "public"."saved_item_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_items" ADD CONSTRAINT "saved_items_file_id_fk" FOREIGN KEY ("saved_item_file_id") REFERENCES "public"."saved_item_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_item_attributes" ADD CONSTRAINT "saved_item_attributes_item_id_fk" FOREIGN KEY ("saved_item_id") REFERENCES "public"."saved_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_item_attributes" ADD CONSTRAINT "saved_item_attributes_source_page_id_fk" FOREIGN KEY ("saved_item_source_page_id") REFERENCES "public"."saved_item_source_pages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_item_variants" ADD CONSTRAINT "saved_item_variants_item_id_fk" FOREIGN KEY ("saved_item_id") REFERENCES "public"."saved_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "saved_item_variants" ADD CONSTRAINT "saved_item_variants_source_page_id_fk" FOREIGN KEY ("saved_item_source_page_id") REFERENCES "public"."saved_item_source_pages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_pdfs" ADD CONSTRAINT "source_pdfs_saved_item_file_id_fk" FOREIGN KEY ("saved_item_file_id") REFERENCES "public"."saved_item_files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_item_files_workspace_sha_unique" ON "saved_item_files" USING btree ("workspace_id","sha256");
--> statement-breakpoint
CREATE INDEX "saved_item_files_workspace_id_idx" ON "saved_item_files" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_item_source_pages_file_page_unique" ON "saved_item_source_pages" USING btree ("saved_item_file_id","page_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_items_workspace_file_unique" ON "saved_items" USING btree ("workspace_id","saved_item_file_id");
--> statement-breakpoint
CREATE INDEX "saved_items_workspace_updated_idx" ON "saved_items" USING btree ("workspace_id","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_item_attributes_item_key_unique" ON "saved_item_attributes" USING btree ("saved_item_id","key");
--> statement-breakpoint
CREATE INDEX "saved_item_variants_item_sort_idx" ON "saved_item_variants" USING btree ("saved_item_id","sort_order");
