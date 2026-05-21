# UI Phase 1 Handoff — Foundation + Auth + Dashboard

You are picking up after the first UI slice landed. Backend is unchanged
since [step-8-final-handoff.md](step-8-final-handoff.md) (which remains the
source of truth for endpoint shapes, polling cadence, and the
read-only-after-export contract). Ignore any "Step 9" references in those
docs — there is no Step 9. UI work is being tracked as numbered UI phases
instead.

## What I built

**Foundation** in `apps/web`:

- Tailwind v3 + `tailwindcss-animate`, PostCSS, autoprefixer.
- TanStack Query (with provider + sane defaults), react-hook-form +
  `@hookform/resolvers/zod`, Sonner toasts, Lucide icons,
  cva/clsx/tailwind-merge.
- Radix primitives (dialog, dropdown-menu, label, slot) backing shadcn-style
  components in `apps/web/src/components/ui/` — Button, Input, Label, Card,
  Skeleton, Dialog, DropdownMenu. These were hand-written from shadcn's
  standard templates (not generated via the CLI) since the CLI is
  interactive; `components.json` is committed so future `pnpm dlx
  shadcn@latest add …` runs will work.
- `apps/web/tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css`
  (default zinc palette).
- `src/lib/utils.ts` (`cn`), `src/lib/api.ts` (typed `fetch` wrapper —
  `credentials: 'include'`, throws structured `ApiError`, reads
  `x-request-id` so it's available for Sentry later),
  `src/lib/auth-client.ts` (better-auth React client pointed at
  `/api/v1/auth`), `src/lib/query-client.ts`.
- `src/components/providers.tsx` wires `QueryClientProvider` + `<Toaster />`.
- Root [apps/web/src/app/layout.tsx](apps/web/src/app/layout.tsx) imports
  `globals.css` and renders `<Providers>{children}</Providers>`. The old
  stub `app/page.tsx` was deleted — `/` is now owned by the
  `(dashboard)` route group.

**Backend tweak** (only thing I touched outside `apps/web/src/app` and
`apps/web/src/lib`):

- [apps/web/src/server/auth.ts:60](apps/web/src/server/auth.ts:60) —
  `requireEmailVerification: false`, `autoSignIn: true`. Per scoping
  decision: skip the email-verify gate for pilot so signup → straight to
  dashboard. The Resend hook is still wired (harmless when not gating);
  flip both flags back to re-enable later. All 29 existing web tests still
  pass after this change.

**Screen 1 — Auth** (`apps/web/src/app/(auth)/…`):

- `layout.tsx` — server component, redirects to `/` if a session already
  exists; otherwise centers a single card.
- `login/page.tsx` — Zod-validated form, submits via
  `authClient.signIn.email`, redirects to `/` on success.
- `signup/page.tsx` — fields match the backend `SignupBody` shape (`email`,
  `password`, `name`, `sub_company_name`, `workspace_name`). Posts to
  `/api/v1/auth/signup` (not the better-auth client — that endpoint has the
  custom workspace-creating wrapper). Surfaces `409 email_in_use` inline.

**Screen 2 — Dashboard** (`apps/web/src/app/(dashboard)/…`):

- `layout.tsx` — server component, calls `auth.api.getSession`; 401 →
  `redirect('/login')`. Renders the persistent header.
- `_components/header.tsx` — branded link + Projects link + user menu.
- `_components/user-menu.tsx` — Radix dropdown with name + sign-out.
- `page.tsx` — TanStack Query against `GET /api/v1/projects`, client-side
  search, loading skeletons, empty state with the wireframe copy, error
  state. Each row is a `<Link>` to `/projects/[id]`.
- `_components/new-project-dialog.tsx` — Radix Dialog + react-hook-form,
  posts to `/api/v1/projects`, invalidates the query, toasts, pushes to the
  new project's detail page.

## What's wired vs. what's stubbed

- The dashboard rows and the "create project → push to detail" both
  navigate to `/projects/[id]`, **which does not exist yet**. That route is
  the first thing in the next phase.
- "Recent packages" from wireframe Screen 2 is **deliberately deferred** —
  there is no efficient backend endpoint and the wireframe itself notes
  it's optional at MVP.
- No mobile-warning banner yet (wireframe calls for one under ≤1024 px).
- No "Check your email" screen — needed only if you re-enable
  `requireEmailVerification`.

## Verification I ran

```powershell
pnpm --filter @submittal/web typecheck   # green
pnpm --filter @submittal/web lint        # green
pnpm --filter @submittal/web build       # green (only pre-existing sharp warnings)
pnpm --filter @submittal/web test        # 29/29 passing
```

To smoke-test the slice manually:

```powershell
pnpm --filter @submittal/web dev
```

Then `/` → redirects to `/login` → create account → land on dashboard →
`+ New project`. Following a project link 404s — that's expected and is
your starting point.

## Where to start

Read [step-6-wireframes.md](step-6-wireframes.md) Screen 3 onward and
[step-8-final-handoff.md](step-8-final-handoff.md) for endpoint shapes.

The natural next slice is **Screen 3 (Project detail) + new package modal**,
because dashboard navigation already points at `/projects/[id]`. The
endpoint is `GET /api/v1/projects/:id` (returns `{ project, packages }`)
and `POST /api/v1/projects/:id/packages`. Schemas live in
`packages/shared/src/api/projects.ts` and `…/packages.ts`.

After that, the wireframes in order are:

- Screen 4 — upload + processing (`/packages/[id]` while
  `status in ('draft','processing')`)
- Screen 5 — package editor (the marquee; expand-to-edit rows, citation
  drawer, dnd-kit reorder, doc-type reclassify, mark-reviewed)
- Screen 6 — cover sheet form
- Screen 7 — export flow (confirmation → render polling → ready/download,
  previous-exports list, read-only-after-export banner)

But scope per session is your call — talk to the user.

## Conventions you should keep

- All API calls go through `apps/web/src/lib/api.ts` (so `x-request-id`
  capture works uniformly). Don't roll a raw `fetch`.
- All Zod schemas come from `@submittal/shared/api` — import them, don't
  re-declare. Form schemas can wrap them when the form's shape differs from
  the wire shape, but the wire-shape contract should always come from
  shared.
- Server-side auth gating happens in route-group layouts via
  `auth.api.getSession({ headers: await headers() })`. Follow the pattern
  in `(dashboard)/layout.tsx`.
- shadcn-style primitives go in `src/components/ui/`. Feature components
  go in `src/app/<route-group>/_components/` (private folder, not a route).
- Use TanStack Query for reads. Use `useMutation` + `invalidateQueries` for
  writes. Don't use server actions for /api/v1 calls — the REST contract
  is the source of truth and server actions would be a second access path.

## Deliverable for the next agent (you)

**Before you end your session, write a similar handoff doc** at the repo
root — `ui-phase-2-handoff.md` (or whatever number matches your slice).
Same structure as this one: what you built, what's wired vs. stubbed, the
verification commands you ran, and where the agent after you should pick
up. Keep it concise — no full build plans (that's your successor's job).
The point of the chain is that every agent picks up cold and the previous
doc is enough to orient them in ~5 minutes.
