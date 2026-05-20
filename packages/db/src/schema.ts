// Drizzle schema for Submittal Builder MVP.
//
// Tables mirror the data model in
// `review-product-brief-md-we-are-quirky-cat.md`. Auth tables (users, sessions,
// accounts, verifications) are owned by better-auth — we still declare them
// here so Drizzle generates the migration and our `withWorkspace()` helper can
// reference foreign keys against `users.id`.
//
// Naming: snake_case in SQL, camelCase in TS (matches Drizzle convention).
// All UUIDs default to `gen_random_uuid()` (Postgres built-in since 13).

import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  doublePrecision,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const packageStatus = pgEnum('package_status', [
  'draft',
  'processing',
  'ready',
  'exported',
]);

export const pdfProcessingStatus = pgEnum('pdf_processing_status', [
  'uploaded',
  'ocr_running',
  'classifying',
  'extracted',
  'error',
]);

export const itemDocType = pgEnum('item_doc_type', [
  'product_data',
  'shop_drawing',
  'sds',
  'warranty',
  'installation',
  'test_report',
  'other',
]);

export const jobKind = pgEnum('job_kind', ['ocr', 'classify', 'extract', 'batch_order']);

export const jobStatus = pgEnum('job_status', ['queued', 'running', 'succeeded', 'failed']);

// ---------------------------------------------------------------------------
// Workspaces (tenancy root) + users
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  subCompanyName: text('sub_company_name').notNull(),
  subCompanyLogoStorageKey: text('sub_company_logo_storage_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// better-auth manages this table. Per step-7, we use better-auth's column
// shape; our `password_hash` from the data model lives on `accounts.password`
// instead (better-auth puts credentials in the linked-account row).
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull(),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex('users_email_unique').on(t.email),
    workspaceIdx: index('users_workspace_id_idx').on(t.workspaceId),
  }),
);

// ---------------------------------------------------------------------------
// better-auth: sessions, accounts, verifications
// (Names plural per step-7 §3. better-auth config maps to these names.)
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenUnique: uniqueIndex('sessions_token_unique').on(t.token),
    userIdx: index('sessions_user_id_idx').on(t.userId),
    expiresIdx: index('sessions_expires_at_idx').on(t.expiresAt),
  }),
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    // argon2id hash for the `credential` provider. NULL for OAuth-only accounts.
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('accounts_user_id_idx').on(t.userId),
    providerLookup: uniqueIndex('accounts_provider_account_unique').on(t.providerId, t.accountId),
  }),
);

export const verifications = pgTable(
  'verifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    identifierIdx: index('verifications_identifier_idx').on(t.identifier),
  }),
);

// ---------------------------------------------------------------------------
// Projects, packages
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    projectNumber: text('project_number'),
    gcName: text('gc_name'),
    architectName: text('architect_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    workspaceDeletedIdx: index('projects_workspace_deleted_idx').on(t.workspaceId, t.deletedAt),
  }),
);

export const packages = pgTable(
  'packages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    submittalNumber: text('submittal_number').notNull(),
    specSection: text('spec_section').notNull(),
    revision: text('revision').notNull().default('R0'),
    submittalDate: date('submittal_date'),
    title: text('title'),
    status: packageStatus('status').notNull().default('draft'),
    // FK is set deferred — declared below `exports` so we don't reference a
    // not-yet-defined table at evaluation time.
    latestExportId: uuid('latest_export_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    projectDeletedIdx: index('packages_project_deleted_idx').on(t.projectId, t.deletedAt),
    workspaceStatusIdx: index('packages_workspace_status_idx').on(t.workspaceId, t.status),
  }),
);

// ---------------------------------------------------------------------------
// Source PDFs and pages
// ---------------------------------------------------------------------------

export const sourcePdfs = pgTable(
  'source_pdfs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }),
    sha256: text('sha256'),
    pageCount: integer('page_count'),
    processingStatus: pdfProcessingStatus('processing_status').notNull().default('uploaded'),
    processingError: text('processing_error'),
    // itemId FK declared after `items` is defined (see addendum below).
    itemId: uuid('item_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    packageIdx: index('source_pdfs_package_id_idx').on(t.packageId),
    sha256Idx: index('source_pdfs_sha256_idx').on(t.sha256),
  }),
);

export const sourcePages = pgTable(
  'source_pages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sourcePdfId: uuid('source_pdf_id')
      .notNull()
      .references(() => sourcePdfs.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    ocrText: text('ocr_text'),
    hasOcr: boolean('has_ocr').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourcePdfPageUnique: uniqueIndex('source_pages_source_pdf_page_unique').on(
      t.sourcePdfId,
      t.pageNumber,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Items + attributes
// ---------------------------------------------------------------------------

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    docType: itemDocType('doc_type').notNull().default('other'),
    docTypeConfidence: doublePrecision('doc_type_confidence'),
    docTypeOriginalAiValue: text('doc_type_original_ai_value'),
    sortOrder: integer('sort_order').notNull().default(0),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    packageSortIdx: index('items_package_sort_idx').on(t.packageId, t.sortOrder),
  }),
);

export const itemAttributes = pgTable(
  'item_attributes',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    currentValue: text('current_value'),
    originalAiValue: text('original_ai_value'),
    confidence: doublePrecision('confidence'),
    sourcePageId: uuid('source_page_id').references(() => sourcePages.id, { onDelete: 'set null' }),
    editedByUserAt: timestamp('edited_by_user_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    itemKeyUnique: uniqueIndex('item_attributes_item_key_unique').on(t.itemId, t.key),
    // V1.1 forward-looking partial index — `spec_section_ref` is heavily queried.
    specSectionRefIdx: index('item_attributes_spec_section_ref_idx')
      .on(t.key)
      .where(sql`${t.key} = 'spec_section_ref'`),
  }),
);

// ---------------------------------------------------------------------------
// Exports + processing_jobs
// ---------------------------------------------------------------------------

export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  packageId: uuid('package_id')
    .notNull()
    .references(() => packages.id, { onDelete: 'cascade' }),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  storageKey: text('storage_key').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }),
  pageCount: integer('page_count'),
  batesPrefix: text('bates_prefix'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const processingJobs = pgTable(
  'processing_jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    sourcePdfId: uuid('source_pdf_id').references(() => sourcePdfs.id, { onDelete: 'cascade' }),
    kind: jobKind('kind').notNull(),
    status: jobStatus('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    packageStatusIdx: index('processing_jobs_package_status_idx').on(t.packageId, t.status),
    statusKindIdx: index('processing_jobs_status_kind_idx').on(t.status, t.kind),
  }),
);

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type Package = typeof packages.$inferSelect;
export type SourcePdf = typeof sourcePdfs.$inferSelect;
export type SourcePage = typeof sourcePages.$inferSelect;
export type Item = typeof items.$inferSelect;
export type ItemAttribute = typeof itemAttributes.$inferSelect;
export type Export = typeof exports.$inferSelect;
export type ProcessingJob = typeof processingJobs.$inferSelect;
