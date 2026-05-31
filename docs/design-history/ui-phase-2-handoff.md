# UI Phase 2 Handoff — Project Detail + New Package Modal

You are picking up after Phase 2 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md); Phase 1 context is in
[ui-phase-1-handoff.md](ui-phase-1-handoff.md). UI work is tracked as
numbered UI phases.

## What I built

**Screen 3 — Project detail** at
[apps/web/src/app/(dashboard)/projects/[id]/page.tsx](apps/web/src/app/(dashboard)/projects/[id]/page.tsx):

- Client component. `useQuery({ queryKey: ['project', id] })` against
  `GET /api/v1/projects/:id` through `@/lib/api`. Types from
  `ProjectDetailResponse` in `@submittal/shared/api`.
- Header: back link to `/`, project name, subheader joining
  `Project #…`, `GC: …`, `Architect: …` with the same `   ·   `
  separator the dashboard uses.
- Packages section: section title + `[+ New package]` button (right),
  client-side search input below, then the list.
- States mirror the dashboard: `LoadingState` (3-row Skeleton on header +
  rows), `NotFoundState` (when `ApiError.status === 404`),
  `ErrorState` (generic), `EmptyState` (dashed-border card with CTA), and
  the success list. Search filters over `submittal_number` and `revision`
  (the only string fields exposed on `projectPackageSummarySchema`).
- Each row is a `<Link href={`/packages/${pkg.id}`}>` showing
  `{submittal_number}` + `{revision}` left, a status `<Badge>` and a
  chevron right. `Last updated {relative}` under the row title.

**New package modal** at
[apps/web/src/app/(dashboard)/projects/[id]/_components/new-package-dialog.tsx](apps/web/src/app/(dashboard)/projects/[id]/_components/new-package-dialog.tsx):

- Mirrors the `new-project-dialog` pattern: Radix Dialog + react-hook-form
  + zod resolver + TanStack `useMutation` + `invalidateQueries` +
  sonner toast + `router.push`.
- Required fields: `submittal_number`, `spec_section`. Optional:
  `revision` (free text, blank → omitted so backend default `R0` applies),
  `title`, `submittal_date` (HTML `type="date"`, validated against the
  same `YYYY-MM-DD` regex the wire schema uses).
- POSTs to `/api/v1/projects/{projectId}/packages`. On success:
  invalidates `['project', projectId]`, toasts
  `Created {submittal_number}`, navigates to `/packages/{pkg.id}`.
- Field id prefix `npk-` so it doesn't collide with the project dialog
  if both ever mount.

**New UI primitive** at
[apps/web/src/components/ui/badge.tsx](apps/web/src/components/ui/badge.tsx):

- Hand-written shadcn-style Badge (`cva` with `default` / `secondary` /
  `outline` / `destructive` variants), same approach Phase 1 used for the
  other primitives.
- Status → variant mapping in the row:
  `draft → outline`, `processing → secondary`, `ready → default`,
  `exported → secondary`. Neutral palette — wireframe doesn't color-code
  status badges.

## What's wired vs. what's stubbed

- Package rows link to `/packages/[id]`, **which does not exist yet** —
  same shape as Phase 1 left `/projects/[id]` for me. That route is the
  first thing in the next phase.
- Package row content is intentionally trimmed to the summary schema
  (`submittal_number`, `revision`, `status`, `updated_at`). The
  wireframe shows title and item count, but
  `projectPackageSummarySchema` doesn't expose those, and per Phase 1's
  ground rule the backend was not touched. If the design needs them in
  the row, add `title` + `item_count` to the summary schema and the GET
  `/projects/:id` handler before the UI side.
- `[Edit project]` button (wireframe) is **deferred** — not needed to
  unblock the package flow. `PATCH /api/v1/projects/:id` already exists;
  add a small dialog mirroring `new-project-dialog` when you want it.
- No mobile-warning banner yet (still owed from Phase 1).

## Verification I ran

```powershell
pnpm --filter @submittal/web typecheck   # green
pnpm --filter @submittal/web lint        # green (no warnings/errors)
pnpm --filter @submittal/web build       # green (only pre-existing sharp warnings)
pnpm --filter @submittal/web test        # 29/29 passing
```

To smoke-test the slice manually:

```powershell
pnpm --filter @submittal/web dev
```

Then `/` → sign in / sign up → land on dashboard → create or open a
project → land on `/projects/[id]` with empty state → `+ New package` →
fill `submittal_number` + `spec_section` (others optional) → toast +
list refetches + browser navigates to `/packages/[id]` (expected 404 —
that's where Phase 3 picks up). Visit
`/projects/00000000-0000-0000-0000-000000000000` to see the friendly
"Project not found" state.

## Where to start

[wireframes.md](wireframes.md) Screen 4 onward. The
package row's `<Link>` already aims at `/packages/[id]`, so the natural
next slice is **Screen 4 — upload + processing**:

- Route: `apps/web/src/app/(dashboard)/packages/[id]/page.tsx`.
- Read endpoint: `GET /api/v1/packages/:id` →
  `packageDetailResponseSchema` (`packageSchema` + `source_pdf_count` +
  `item_count` + `latest_export`).
- Branching on `status`: `draft` / `processing` → upload + processing
  view (this phase); `ready` → editor (Screen 5, the marquee work);
  `exported` → read-only editor with banner (also Screen 5).
- For upload: presign + confirm flow at
  `POST /api/v1/packages/:id/source-pdfs/presign` and
  `POST /api/v1/packages/:id/source-pdfs/:sourcePdfId/confirm`.
- For processing: poll `GET /api/v1/packages/:id/status` every 2 s
  until `status === 'ready'` or any `source_pdfs[].processing_status ===
  'error'` (per [step-8-final-handoff.md](step-8-final-handoff.md)).

After that the wireframe order is Screen 5 (package editor — the big
one), Screen 6 (cover sheet), Screen 7 (export flow). Scope per session
is your call — talk to the user.

## Conventions you should keep

Same set as Phase 1, restated:

- All API calls through [apps/web/src/lib/api.ts](apps/web/src/lib/api.ts)
  so `x-request-id` capture stays uniform. Don't roll a raw `fetch`.
- All Zod schemas come from `@submittal/shared/api` — import them, don't
  re-declare. Form schemas can wrap them when the form's shape differs.
- Server-side auth gating lives in route-group layouts via
  `auth.api.getSession({ headers: await headers() })`. The `(dashboard)`
  layout already covers everything under
  `/projects/...` and `/packages/...`.
- shadcn-style primitives in `src/components/ui/`. Feature components in
  `src/app/<route-group>/<route>/_components/` (private folder, not a
  route).
- TanStack Query for reads; `useMutation` + `invalidateQueries` for
  writes. No server actions for /api/v1 calls — the REST contract is the
  source of truth.
- Loading skeletons over spinners. Toasts top-right (already wired in
  Phase 1 providers).
- Status badges use the variant map above — neutral, no color-coding.

## Deliverable for the next agent (you)

Before you end your session, write `ui-phase-3-handoff.md` (or whatever
number matches your slice) at the repo root. Same shape as this one:
what you built, what's wired vs. stubbed, the verification commands
you ran, and where the agent after you should pick up. Keep it concise
— every agent picks up cold and the previous doc should orient them in
~5 minutes.
