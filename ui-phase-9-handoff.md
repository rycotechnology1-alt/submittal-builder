# UI Phase 9 Handoff — "Processing complete" confirmation moment

You are picking up after Phase 9 landed. Backend is unchanged since
[step-8-final-handoff.md](step-8-final-handoff.md). Phase 8 UI + backend-bug
context is in [ui-phase-8-handoff.md](ui-phase-8-handoff.md). UI work is
tracked as numbered UI phases.

## What I built

**Screen — "Processing complete" interstitial**. The silent swap from
`<UploadProcessingPanel />` to `<PackageEditor />` (the moment when
`pkg.status` flips from `'processing'` to `'ready'`) is now an explicit
confirmation moment with a forward CTA. The user reported the pre-change
behavior as "having to navigate back to the project then re-select the
package" — i.e. the swap was subtle enough they didn't realize they had
crossed into the editor.

New file:

- `apps/web/src/app/(dashboard)/packages/[id]/_components/processing-complete-panel.tsx` —
  pure presentational client component. Renders a centered card with a
  green `CheckCircle2` icon, "Processing complete", a one-line
  pluralization-aware stats subtitle ("N PDFs · M items ready to review"),
  and a primary "Continue to package →" `Button`. Reads `source_pdf_count`
  + `item_count` from
  [PackageDetailResponse](packages/shared/src/api/packages.ts:28).
  Props: `{ pkg, onContinue }`. No React Query, no mutations.

**Wired into existing page**:

- [packages/[id]/page.tsx](apps/web/src/app/(dashboard)/packages/[id]/page.tsx)
  gained two pieces of session-local state plus one effect:

  ```tsx
  const sawProcessingRef = useRef(false);
  const [hasAcknowledgedReady, setHasAcknowledgedReady] = useState(false);

  useEffect(() => {
    if (packageQuery.data?.status === 'processing') {
      sawProcessingRef.current = true;
    }
  }, [packageQuery.data?.status]);
  ```

  And a new render branch:

  ```tsx
  const isProcessing = pkg.status === 'draft' || pkg.status === 'processing';
  const showCompletionInterstitial =
    !isProcessing && sawProcessingRef.current && !hasAcknowledgedReady;
  ```

  - `isProcessing` → `<UploadProcessingPanel />` (unchanged).
  - `showCompletionInterstitial` → `<ProcessingCompletePanel />` with an
    `onContinue` that flips `hasAcknowledgedReady` to `true`.
  - Otherwise → `<PackageEditor />`.

  `sawProcessingRef` lives in React state (not URL / localStorage), so the
  interstitial only appears in the tab session that actually watched
  processing. Reload, fresh navigation from the project list, second tab —
  all skip the interstitial and go straight to the editor. That's the
  intended UX: no stale celebration for users who didn't wait.

**No changes to `<UploadProcessingPanel />`**. Its existing
`invalidateQueries({ queryKey: ['package', packageId] })` on
`data.status === 'ready'`
([upload-processing-panel.tsx:230-232](apps/web/src/app/(dashboard)/packages/[id]/_components/upload-processing-panel.tsx))
already triggers the page-level re-render that now lands on
`<ProcessingCompletePanel />` instead of silently swapping into the editor.

**No backend changes.** All needed data (`source_pdf_count`, `item_count`)
was already on `PackageDetailResponse`.

## What's wired vs. what's stubbed

- **Wired**: forward-only confirmation for the actively-watching user.
  Single CTA → editor.
- **Stubbed (intentional)**: no confetti / animation. No doc-type
  breakdown. No auto-redirect. Quiet, intentional moment.
- **Stubbed**: no "recently completed, never opened" indicator on the
  project list. That requires server-side last-seen tracking (when did the
  user last view this package's editor) and is out of scope. Today, a
  user who navigates away during processing and comes back will land
  directly on the editor — which is the desired "no backward navigation"
  outcome even if it skips the celebration.
- **Edge case — processing fails partway**: `pkg.status` only reaches
  `'ready'` when `batch_order` runs, and `batch_order` only fires when
  every source PDF is `'extracted'`. If any PDF errors, the user stays on
  `<UploadProcessingPanel />` with the existing retry UI. So the interstitial
  is structurally guaranteed not to fire on a failed run.
- **Edge case — user adds another item from the editor**: triggers
  `/process`, `pkg.status` flips back to `'processing'`,
  `sawProcessingRef.current` becomes true (again), and after the new PDF
  finishes the interstitial appears a second time. That's fine — same
  reasoning as the first: the user actively watched processing happen.
  If we wanted to suppress repeat appearances, we'd reset
  `hasAcknowledgedReady` on each `processing` → `ready` cycle; current
  behavior is to leave `hasAcknowledgedReady` sticky so they only see the
  interstitial once per page mount. **Verify in manual smoke** — this is
  the only behavioral nuance worth checking.

## Verification I ran

```powershell
pnpm --filter @submittal/web typecheck
pnpm --filter @submittal/web lint
pnpm --filter @submittal/web test
pnpm --filter @submittal/web build
```

Results:

- Full web test suite: **14 files / 128 tests passing** (unchanged from
  end of Phase 8 — no new tests added; the new component is trivial and
  the routing change is pure UI state).
- Typecheck, lint, and build pass.
- Build still prints the pre-existing Sentry global-error warning,
  source-map advisory, and Next lint-deprecation notice.
- Tests still print the pre-existing Resend sandbox warnings.
- `/packages/[id]` route size: **37.7 kB / 201 kB First Load JS** (+0.3 kB
  from end of Phase 8 — just the new presentational component).

**Manual browser smoke**: not run this session. Suggested checks:

1. Create a fresh package → land on the upload page (status='draft').
2. Drop 1–2 small PDFs → observe progress: upload → processing → all rows
   "Ready · Extracted".
3. Expect: page transitions from `<UploadProcessingPanel />` to
   `<ProcessingCompletePanel />` showing "Processing complete · N PDFs
   · M items ready to review · [Continue to package →]".
4. Click Continue → land on `<PackageEditor />` with the new items in the
   list.
5. Refresh the page → land directly on `<PackageEditor />` (no
   celebration replay).
6. From the project list, click a different already-`ready` package →
   land directly on `<PackageEditor />` (no spurious celebration).
7. From the editor, click `+ Add item` and pick a PDF → page swaps to
   `<UploadProcessingPanel />`, then back to `<ProcessingCompletePanel />`
   on completion (because `sawProcessingRef` flips again). Confirm this
   is the expected UX. If it's annoying, we'd reset
   `hasAcknowledgedReady` only on the first transition.

## Where to start

Remaining slices from prior handoffs:

- **Toughen the export polling for slow renders** — Phase 8 left the
  background-export completion gap unresolved. A page-level "exports in
  flight" indicator that polls `GET /packages/:id/exports` and toasts on
  completion would close that loop. Reference:
  [exported-package-view.tsx:44-54](apps/web/src/app/(dashboard)/packages/[id]/_components/exported-package-view.tsx)
  has most of the listing logic already.
- **Workspace settings polish** — global "Settings" nav entry on
  [_components/header.tsx](apps/web/src/app/(dashboard)/_components/header.tsx),
  logo remove endpoint + control, server-side logo and source-PDF byte
  caps.
- **Upload helper consolidation** — extract the presign→PUT→confirm trio
  shared by
  [upload-processing-panel.tsx:136-188](apps/web/src/app/(dashboard)/packages/[id]/_components/upload-processing-panel.tsx)
  and
  [add-item-button.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/editor/add-item-button.tsx)
  into `lib/upload-source-pdf.ts`. Low priority — wait for a third caller.
- **Project-list "Ready · click to open" emphasis** — the user explicitly
  asked for no backward navigation. The current project list shows a
  "Ready" badge but isn't strongly affordant. A small polish — make the
  whole row more visibly clickable when status='ready', or surface
  "recently completed" packages at the top — would round out the flow.
  Server-side "last opened" tracking would be the more durable version
  but isn't strictly required.
- **Phase 8 follow-ups specific to "+ Add item"**:
  - Drag-and-drop into the editor (currently only the file picker works).
  - Show a transient "Adding *filename.pdf*…" affordance in the items list
    *before* the processing panel swap, so the user has a beat to confirm
    the right file was picked.
  - Server-side size cap on `sourcePdfPresignRequestSchema`.
- **Delete the orphan exports view files** —
  [exported-package-view.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/exported-package-view.tsx)
  and
  [pdf-preview.tsx](apps/web/src/app/(dashboard)/packages/[id]/_components/pdf-preview.tsx)
  have no callers after Phase 8. Safe to remove; only kept as reference.

Before ending the next session, write `ui-phase-10-handoff.md` at the repo
root with the same structure as this handoff.
