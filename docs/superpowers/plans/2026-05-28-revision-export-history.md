# Revision + Export History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the revision label a user choice made at export time, stamp it onto each export, and surface a downloadable list of past exports — with no locking, cloning, or forced revisions.

**Architecture:** Add a `revision` column to the `exports` table. The Export dialog gains a revision selector; the create-export endpoint writes the chosen label to `packages.revision` (single source of truth for the cover render) and stamps it onto the new export row. The package editor keeps the compact latest-export banner and adds a collapsible "Previous exports" list driven by the existing `GET /packages/[id]/exports` endpoint. Delete the dead lock-after-export helper and fix the stale e2e assertion.

**Tech Stack:** Next.js (App Router) + React Query, Drizzle ORM + Postgres (Neon), Zod shared schemas, Vitest (integration), tsx smoke scripts. Monorepo via pnpm workspaces.

---

## Spec reconciliation note

The spec ([docs/superpowers/specs/2026-05-28-revision-export-history-design.md](../specs/2026-05-28-revision-export-history-design.md)) lists deleting an orphaned `ExportedPackageView` component. That component no longer exists in the codebase — only the dead `packageExportedError()` helper remains. Task 6 therefore scopes cleanup to the helper only.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/db/src/schema.ts` | Drizzle table definitions | Add `revision` column to `exports` |
| `packages/db/drizzle/0003_*.sql` + `meta/` | Migration | Generated `ADD COLUMN` + manual backfill |
| `packages/shared/src/api/exports.ts` | Export API contract | Add `revision` to `exportSchema` + `createExportRequestSchema` |
| `packages/shared/src/api/packages.ts` | Package API contract | Add `revision` to latest-export summary schema |
| `apps/web/src/server/phase2-records.ts` | Row→JSON mappers + helpers | Add `revision` to two mappers; delete `packageExportedError()` |
| `apps/web/src/app/api/v1/packages/[id]/exports/route.ts` | Create-export endpoint | Write chosen revision to package + stamp export row |
| `apps/web/tests/phase5.integration.test.ts` | API integration tests | New tests for revision stamping + history |
| `apps/web/.../editor/export-dialog.tsx` | Export confirm dialog | "Export as" revision selector |
| `apps/web/.../editor/export-history.tsx` (new) | Previous-exports list | New collapsible component |
| `apps/web/.../editor/export-status-banner.tsx` | Latest-export banner | Show revision label; mount history list |
| `apps/web/tests/e2e-backend.ts` | Backend smoke | Edit-after-export expects 200; second export under bumped revision; history labels |

---

## Task 1: Add `revision` column to the `exports` table

**Files:**
- Modify: `packages/db/src/schema.ts:336-358` (the `exports` table)
- Generate: `packages/db/drizzle/0003_export_revision.sql` + `packages/db/drizzle/meta/*`

- [ ] **Step 1: Add the column to the Drizzle schema**

In `packages/db/src/schema.ts`, inside the `exports` table definition, add the `revision` field after `batesPrefix` (around line 349):

```ts
    batesPrefix: text('bates_prefix'),
    revision: text('revision'),
    status: exportStatus('status').notNull().default('pending'),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `packages/db/drizzle/0003_*.sql` containing
`ALTER TABLE "exports" ADD COLUMN "revision" text;` and a new `meta/0003_snapshot.json` + updated `_journal.json`.

- [ ] **Step 3: Append a backfill statement to the generated migration**

Open the generated `packages/db/drizzle/0003_*.sql` and add a backfill line so existing exports show a label. The file should read:

```sql
ALTER TABLE "exports" ADD COLUMN "revision" text;--> statement-breakpoint
UPDATE "exports" SET "revision" = 'R0' WHERE "revision" IS NULL;
```

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: `migrate: ok`.

- [ ] **Step 5: Typecheck the db package**

Run: `pnpm --filter @submittal/db run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/
git commit -m "feat(db): add revision column to exports"
```

---

## Task 2: Add `revision` to the shared API schemas

**Files:**
- Modify: `packages/shared/src/api/exports.ts:7-29`
- Modify: `packages/shared/src/api/packages.ts:20-26`

- [ ] **Step 1: Add `revision` to `exportSchema` and `createExportRequestSchema`**

In `packages/shared/src/api/exports.ts`, add `revision` to the export response shape and accept an optional `revision` on the create request:

```ts
export const exportSchema = z.object({
  id: uuidSchema,
  package_id: uuidSchema,
  status: exportStatusSchema,
  bates_prefix: z.string().nullable(),
  revision: z.string().nullable(),
  byte_size: z.number().int().nonnegative().nullable(),
  page_count: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  created_at: isoTimestampSchema,
  updated_at: isoTimestampSchema,
});

export const createExportRequestSchema = z
  .object({
    bates_prefix: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[A-Za-z0-9._-]+$/, 'Bates prefix may contain only letters, numbers, . _ -')
      .optional(),
    revision: z.string().trim().min(1).max(16).optional(),
  })
  .strict();
```

- [ ] **Step 2: Add `revision` to the latest-export summary schema**

In `packages/shared/src/api/packages.ts`, add `revision` to `packageLatestExportSummarySchema`:

```ts
export const packageLatestExportSummarySchema = z.object({
  id: uuidSchema,
  status: z.enum(['pending', 'rendering', 'ready', 'failed']),
  revision: z.string().nullable(),
  byte_size: z.number().int().nonnegative().nullable(),
  page_count: z.number().int().nonnegative().nullable(),
  created_at: isoTimestampSchema,
});
```

- [ ] **Step 3: Typecheck the shared package**

Run: `pnpm --filter @submittal/shared run typecheck`
Expected: no errors. (TS will now flag the server mappers in Task 3 as missing `revision` — that's expected and fixed there.)

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/api/exports.ts packages/shared/src/api/packages.ts
git commit -m "feat(shared): add revision to export + latest-export schemas"
```

---

## Task 3: Stamp revision on export + write chosen label to package

**Files:**
- Modify: `apps/web/src/server/phase2-records.ts:228-251` (`exportJson`, `latestExportSummaryJson`)
- Modify: `apps/web/src/app/api/v1/packages/[id]/exports/route.ts:37-103` (POST handler)
- Test: `apps/web/tests/phase5.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

In `apps/web/tests/phase5.integration.test.ts`, add this test inside the same `describe` block that contains the existing `POST /packages/:id/exports` tests (after the test at line ~335):

```ts
  it('POST /packages/:id/exports stamps the chosen revision and updates the package', async () => {
    const user = await createAuthedUser('export-revision');
    emails.push(user.email);
    const { pkg } = await createReadyPackageWithItem(user);

    const { POST: exportsPOST } = await loadExportsRoutes();
    const res = await exportsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/exports`, user.cookie, { revision: 'R1' }),
      ctx({ id: pkg.id }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { export_id: string };

    const [exportRow] = await db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.id, body.export_id));
    expect(exportRow!.revision).toBe('R1');

    const [pkgRow] = await db
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.id, pkg.id));
    expect(pkgRow!.revision).toBe('R1');
  });

  it('POST /packages/:id/exports falls back to the package revision when none is given', async () => {
    const user = await createAuthedUser('export-revision-default');
    emails.push(user.email);
    const { pkg } = await createReadyPackageWithItem(user);
    await db.update(schema.packages).set({ revision: 'R2' }).where(eq(schema.packages.id, pkg.id));

    const { POST: exportsPOST } = await loadExportsRoutes();
    const res = await exportsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/exports`, user.cookie, {}),
      ctx({ id: pkg.id }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { export_id: string };

    const [exportRow] = await db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.id, body.export_id));
    expect(exportRow!.revision).toBe('R2');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @submittal/web run test -- phase5.integration`
Expected: FAIL — the new tests fail because `exportRow.revision` is `null` and `pkgRow.revision` is unchanged (`R0`).

- [ ] **Step 3: Update the POST handler to write + stamp the revision**

In `apps/web/src/app/api/v1/packages/[id]/exports/route.ts`, replace the body of the `withWorkspaceFromHeaders` callback (lines 44-96) so it resolves the revision, conditionally updates the package, and stamps the export row:

```ts
  const result = await withWorkspaceFromHeaders(req.headers, async (ctx) => {
    const pkg = await findLivePackage(ctx.workspaceId, id);
    if (!pkg) return notFound();
    if (pkg.status !== 'ready' && pkg.status !== 'exported') {
      return jsonError(
        409,
        'package_not_ready',
        'Package must finish processing before it can be exported',
      );
    }

    const revision = body.revision ?? pkg.revision;
    if (body.revision && body.revision !== pkg.revision) {
      await db
        .update(schema.packages)
        .set({ revision: body.revision, updatedAt: new Date() })
        .where(eq(schema.packages.id, pkg.id));
    }

    const exportId = crypto.randomUUID();
    const storageKey = `workspaces/${ctx.workspaceId}/exports/${exportId}.pdf`;

    const [created] = await db
      .insert(schema.exports)
      .values({
        id: exportId,
        packageId: pkg.id,
        createdByUserId: ctx.userId,
        storageKey,
        batesPrefix: body.bates_prefix ?? null,
        revision,
        status: 'pending',
      })
      .returning();
    if (!created) throw new Error('Export insert returned no row');

    await getProcessingQueue().send(
      'render_export',
      {
        workspaceId: ctx.workspaceId,
        packageId: pkg.id,
        exportId: created.id,
        requestId,
      },
      {
        singletonKey: `render_export:${created.id}`,
        retryLimit: 3,
        retryBackoff: true,
      },
    );

    console.log({
      level: 'info',
      msg: 'export_requested',
      request_id: requestId,
      export_id: created.id,
      package_id: pkg.id,
      workspace_id: ctx.workspaceId,
    });

    return { export_id: created.id };
  });
```

Confirm `eq` is imported at the top of the file (it already imports `desc, eq` from `drizzle-orm`).

- [ ] **Step 4: Add `revision` to the JSON mappers**

In `apps/web/src/server/phase2-records.ts`, add `revision` to both `exportJson` (line 228) and `latestExportSummaryJson` (line 242):

```ts
export function exportJson(row: Export) {
  return {
    id: row.id,
    package_id: row.packageId,
    status: row.status,
    bates_prefix: row.batesPrefix,
    revision: row.revision,
    byte_size: row.byteSize,
    page_count: row.pageCount,
    error: row.error,
    created_at: iso(row.createdAt)!,
    updated_at: iso(row.updatedAt)!,
  };
}

export function latestExportSummaryJson(row: Export | null) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    byte_size: row.byteSize,
    page_count: row.pageCount,
    created_at: iso(row.createdAt)!,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @submittal/web run test -- phase5.integration`
Expected: PASS, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/phase2-records.ts "apps/web/src/app/api/v1/packages/[id]/exports/route.ts" apps/web/tests/phase5.integration.test.ts
git commit -m "feat(api): stamp chosen revision on export and persist to package"
```

---

## Task 4: Add the "Export as" revision selector to the Export dialog

**Files:**
- Modify: `apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-dialog.tsx`

- [ ] **Step 1: Add revision state, seeded from the package**

In `export-dialog.tsx`, near the other `useState` hooks (after `batesPrefix` state, ~line 56), add:

```tsx
  const [revision, setRevision] = useState(pkg.revision);
```

Then in the `useEffect` that resets state when the dialog opens (the `if (open) { ... }` block, ~line 59-65), add:

```tsx
      setRevision(pkg.revision);
```

- [ ] **Step 2: Define the revision options constant**

At module scope near the top of `export-dialog.tsx` (after the imports), add:

```tsx
const REVISION_OPTIONS = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];
```

- [ ] **Step 3: Render the selector in the confirm phase**

In the `phase === 'confirm'` block, immediately before the Bates prefix `<section>` (~line 160), add:

```tsx
            <section className="space-y-1">
              <label htmlFor="export-revision" className="text-sm font-medium">
                Export as
              </label>
              <select
                id="export-revision"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {(REVISION_OPTIONS.includes(revision)
                  ? REVISION_OPTIONS
                  : [revision, ...REVISION_OPTIONS]
                ).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Stamped on the cover sheet and saved with this export.
              </p>
            </section>
```

- [ ] **Step 4: Include revision in the create-export request**

In `startRender()` (~line 109-120), build the request body with the revision:

```tsx
  function startRender() {
    const validation = validateBatesPrefix(batesPrefix);
    if (!validation.ok) {
      setBatesError(validation.message);
      return;
    }
    setBatesError(null);
    const body: CreateExportRequest = { revision };
    if (validation.value) body.bates_prefix = validation.value;
    createMutation.mutate(body);
  }
```

- [ ] **Step 5: Invalidate the package query on success so the cover/banner reflect the new revision**

In the `useEffect` that handles `data.status === 'ready'` (~line 85-89), confirm it already calls `queryClient.invalidateQueries({ queryKey: ['package', pkg.id] })` and `['package-exports', pkg.id]`. It does — no change needed. (This step is a verification checkpoint, not an edit.)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @submittal/web run typecheck`
Expected: no errors.

- [ ] **Step 7: Manual check**

Run the app (`pnpm dev`), open a ready package, click **Export package →**, confirm the "Export as" dropdown appears, defaults to the package's current revision, and that exporting with a different value updates the cover sheet revision afterward.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-dialog.tsx"
git commit -m "feat(ui): choose export revision in the export dialog"
```

---

## Task 5: Surface a downloadable "Previous exports" list

**Files:**
- Create: `apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-history.tsx`
- Modify: `apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-status-banner.tsx`

- [ ] **Step 1: Create the export-history component**

Create `apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-history.tsx`:

```tsx
'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { ChevronDown, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { ApiError, api } from '@/lib/api';
import type { ExportDownloadResponse, ExportResponse } from '@submittal/shared/api';

import { formatBytes, formatRelativeTime } from './export-helpers';

export function ExportHistory({ packageId }: { packageId: string }) {
  const [open, setOpen] = useState(false);

  const exportsQuery = useQuery({
    queryKey: ['package-exports', packageId],
    queryFn: () => api.get<ExportResponse[]>(`/api/v1/packages/${packageId}/exports`),
  });

  const downloadMutation = useMutation({
    mutationFn: (exportId: string) =>
      api.get<ExportDownloadResponse>(
        `/api/v1/exports/${exportId}/download?disposition=attachment`,
      ),
    onSuccess: (data) => triggerBrowserDownload(data.url),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not generate download link.'),
  });

  const ready = (exportsQuery.data ?? []).filter((e) => e.status === 'ready');
  // The newest export is already shown in the banner; list the rest here.
  const previous = ready.slice(1);
  if (previous.length === 0) return null;

  return (
    <div className="mb-4 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium"
        aria-expanded={open}
      >
        <span>Previous exports ({previous.length})</span>
        <ChevronDown
          className={'h-4 w-4 transition-transform ' + (open ? 'rotate-180' : '')}
        />
      </button>
      {open ? (
        <ul className="divide-y border-t">
          {previous.map((exp) => (
            <li key={exp.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{exp.revision ?? '—'}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {exp.page_count != null ? `${exp.page_count} pages · ` : ''}
                  {formatBytes(exp.byte_size)} · {formatRelativeTime(exp.created_at)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => downloadMutation.mutate(exp.id)}
                disabled={downloadMutation.isPending}
                className="inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs font-medium hover:bg-muted"
              >
                {downloadMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Download
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function triggerBrowserDownload(url: string): void {
  if (typeof window === 'undefined') return;
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.setAttribute('download', '');
  document.body.appendChild(link);
  link.click();
  link.remove();
}
```

- [ ] **Step 2: Show the revision label in the latest-export banner**

In `export-status-banner.tsx`, update the metadata line (~line 48-52) to lead with the revision label:

```tsx
        <p className="text-xs text-muted-foreground">
          {latest.revision ? `${latest.revision} · ` : ''}
          {latest.page_count != null ? `${latest.page_count} pages · ` : ''}
          {formatBytes(latest.byte_size)} · rendered {formatRelativeTime(latest.created_at)}
          {isExported ? '' : ' · re-export to publish your edits'}
        </p>
```

(`latest` is `pkg.latest_export`, whose summary type now includes `revision` from Task 2.)

- [ ] **Step 3: Mount the history list under the banner**

In `package-editor.tsx`, the `ExportStatusBanner` is rendered at line ~383. Add the history list directly beneath it:

```tsx
        <ExportStatusBanner pkg={pkg} />
        <ExportHistory packageId={packageId} />
```

And add the import near the other editor imports (after the `ExportStatusBanner` import, ~line 24):

```tsx
import { ExportHistory } from './export-history';
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @submittal/web run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual check**

In the running app: export a package as R0, add an item, export again as R1. Confirm the banner shows "R1 …" and a "Previous exports (1)" disclosure expands to show the R0 export with a working Download button.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-history.tsx" "apps/web/src/app/(dashboard)/packages/[id]/_components/editor/export-status-banner.tsx" "apps/web/src/app/(dashboard)/packages/[id]/_components/editor/package-editor.tsx"
git commit -m "feat(ui): downloadable previous-exports list with revision labels"
```

---

## Task 6: Delete the dead lock-after-export helper

**Files:**
- Modify: `apps/web/src/server/phase2-records.ts:220-226`

- [ ] **Step 1: Confirm the helper is unused**

Run: `git grep -n "packageExportedError"`
Expected: the only match is the definition in `apps/web/src/server/phase2-records.ts`. (If any caller appears, stop — it is not dead; re-evaluate before deleting.)

- [ ] **Step 2: Delete the helper**

Remove the entire `packageExportedError()` function (lines 220-226):

```ts
export function packageExportedError() {
  return jsonError(
    409,
    'package_exported',
    'Package is exported and cannot be modified. Create a new revision to make edits.',
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @submittal/web run typecheck`
Expected: no errors (nothing referenced it).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/server/phase2-records.ts
git commit -m "chore: remove dead packageExportedError helper"
```

---

## Task 7: Fix the e2e smoke test for editable-after-export behavior

**Files:**
- Modify: `apps/web/tests/e2e-backend.ts:304-334`

- [ ] **Step 1: Replace the stale 409 assertion with edit-after-export + re-export**

In `apps/web/tests/e2e-backend.ts`, replace the block at lines 304-316 (the `re-edit attempt … should 409` section) with an assertion that the edit now succeeds and a second export under a bumped revision works:

```ts
  console.log('[e2e] re-edit after export should now succeed (no lock)');
  const reEditRes = await fetch(url(`/api/v1/items/${target.item.id}/attributes/${beforeAttr.key}`), {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
      cookie: jar.header(),
    },
    body: JSON.stringify({ value: `${edited} (post-export)` }),
  });
  if (reEditRes.status !== 200) {
    throw new Error(`Expected 200 on post-export edit, got ${reEditRes.status}`);
  }

  console.log('[e2e] second export under a bumped revision');
  const exportRes2 = await post<{ export_id: string }>(`/api/v1/packages/${pkg.id}/exports`, {
    revision: 'R1',
  });
  await pollExportReady(exportRes2.export_id);

  console.log('[e2e] export history lists both revisions');
  const history = await get<Array<{ id: string; status: string; revision: string | null }>>(
    `/api/v1/packages/${pkg.id}/exports`,
  );
  const readyRevisions = history.filter((e) => e.status === 'ready').map((e) => e.revision);
  if (!readyRevisions.includes('R0') || !readyRevisions.includes('R1')) {
    throw new Error(`Expected R0 and R1 in export history, got ${JSON.stringify(readyRevisions)}`);
  }
```

Note: the first export earlier in the test (line ~288) sends no `revision`, so the package's default `R0` is stamped on it — that is the `R0` asserted above.

- [ ] **Step 2: Add the second export id to the final summary (optional but tidy)**

In the final `console.log(JSON.stringify({ ... }))` summary object (~line 318-333), add:

```ts
        export_id_r1: exportRes2.export_id,
```

- [ ] **Step 3: Run the smoke test**

Ensure the web app + worker are running against the dev DB, then run: `pnpm smoke:e2e`
Expected: exits `0`, prints the final `{ ok: true, ... }` summary, and no `Expected …` errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/e2e-backend.ts
git commit -m "test(e2e): assert editable-after-export and revisioned re-export"
```

---

## Final verification

- [ ] **Run the full web test suite**

Run: `pnpm --filter @submittal/web run test`
Expected: all pass.

- [ ] **Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Smoke test green**

Run: `pnpm smoke:e2e`
Expected: `{ ok: true, ... }`, exit 0.

---

## Self-review notes

- **Spec coverage:** §1 data model → Task 1; §2 export flow → Tasks 2-4; §3 history UI → Tasks 2,3,5; §4 cleanup+test → Tasks 6,7. Out-of-scope items (worker `'succeeded'` fix, diffing, snapshots, locking) are untouched.
- **Worker:** `render-export.ts` reads `pkg.revision` for the cover and is intentionally not modified — Task 3 ensures the package row carries the chosen revision before the render job runs.
- **Duplicate labels:** no uniqueness constraint added (Task 1) and the selector allows re-picking the same label — multiple R0s are permitted, per the spec.
