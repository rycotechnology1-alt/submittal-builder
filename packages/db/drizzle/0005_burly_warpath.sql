CREATE TABLE "item_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"source_page_id" uuid,
	"part_number" text NOT NULL,
	"size" text NOT NULL,
	"secondary_dims" jsonb,
	"display_label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default_for_size" boolean DEFAULT false NOT NULL,
	"selected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_variants" ADD CONSTRAINT "item_variants_source_page_id_source_pages_id_fk" FOREIGN KEY ("source_page_id") REFERENCES "public"."source_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_variants_item_sort_idx" ON "item_variants" USING btree ("item_id","sort_order");