DELETE FROM "source_pdfs"
WHERE "processing_status" = 'extracted'
  AND "item_id" IS NULL;
--> statement-breakpoint
UPDATE "packages" p
SET "status" = 'ready',
    "updated_at" = now()
WHERE p."status" = 'processing'
  AND EXISTS (
    SELECT 1
    FROM "source_pdfs" sp
    WHERE sp."package_id" = p."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "source_pdfs" sp
    WHERE sp."package_id" = p."id"
      AND (sp."item_id" IS NULL OR sp."processing_status" <> 'extracted')
  );
--> statement-breakpoint
UPDATE "packages" p
SET "status" = 'draft',
    "updated_at" = now()
WHERE p."status" = 'processing'
  AND NOT EXISTS (
    SELECT 1
    FROM "source_pdfs" sp
    WHERE sp."package_id" = p."id"
  );
