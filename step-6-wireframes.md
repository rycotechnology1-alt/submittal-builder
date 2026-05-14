# MVP Wireframes — Submittal Builder (Step 6)

## Context

Steps 4 and 5 defined the data model and API. Step 6 sketches the screens that drive the critical user flow (brief §8). These are **structural wireframes** — layout, hierarchy, key states — not visual design. Visual polish, typography, color, and motion come during build.

**Confirmed via clarifying questions:**

- **Editor layout:** single-pane TOC list with expand-to-edit rows. Citation viewing handled via a slide-out drawer from the right so users never lose their place in the list.
- **Confidence UX:** badges only on low-confidence attributes (threshold ~0.7); every field is clickable to open the citation drawer. Keeps the screen calm so the user's eye lands on what actually needs review.
- **Scope:** three marquee screens at full detail (Dashboard, Package Editor, Export); auth, project detail, upload/processing, cover sheet sketched lightly to ensure flow continuity.

**Design principles (carried through every screen):**

1. **One thing per screen.** The user is in upload-mode, review-mode, or export-mode. Don't blur the modes.
2. **Trust through citation.** Every AI-extracted value is one click from its source page. No floating claims.
3. **Calm by default, loud where it counts.** High-confidence rows look ordinary; low-confidence rows pull the eye.
4. **Keyboard-friendly.** PMs working through 20+ items will reach for Tab, Enter, Esc. Wire shortcuts from day one.

---

## Screen 1 — Auth (light sketch)

Two near-identical screens, `/login` and `/signup`. Centered card.

```
┌────────────────────────────────────────────────┐
│            Submittal Builder                   │
│                                                │
│   [ Email                                ]     │
│   [ Password                             ]     │
│   ─ signup only ─                              │
│   [ Your name                            ]     │
│   [ Company name (sub)                   ]     │
│   [ Workspace name                       ]     │
│                                                │
│   [        Log in / Create account       ]     │
│                                                │
│   Already have an account? Log in              │
└────────────────────────────────────────────────┘
```

Maps to `POST /auth/signup` and `POST /auth/login`. Signup creates workspace + first user atomically.

---

## Screen 2 — Dashboard (Projects list) — full

The landing screen after login. Optimized for "I'm starting work — pick the project."

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Submittal Builder         Projects   Settings              [PM] Pat ▾    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Projects                                          [+ New project]       │
│  ─────────────────────────────────────────────────────────────────────   │
│  [ Search projects…                       ]                              │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ Riverside Office Tower            Project #24-118                  │  │
│  │ GC: Turner   Architect: SOM                       12 packages  ▸   │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ Hillcrest Medical Expansion       Project #25-007                  │  │
│  │ GC: Skanska  Architect: HKS                        4 packages  ▸   │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ Northpoint Logistics Phase 2      Project #24-201                  │  │
│  │ GC: DPR      Architect: Gensler                   28 packages  ▸   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Recent packages                                                         │
│  ─────────────────────────────────────────────────────────────────────   │
│  • 09 51 13-002 R1  Acoustical Ceiling Panels   Riverside   2h ago  ▸    │
│  • 09 65 13-001 R0  Resilient Flooring          Hillcrest   yesterday▸   │
│  • 23 31 13-001 R0  Metal Ductwork              Northpoint  3d ago  ▸    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Empty state:** "No projects yet. Create your first project to start assembling submittals." with a single CTA.

**API:** `GET /projects`, and a future `GET /packages?recent=true` (or derive recent client-side from project listings at MVP).

**Interactions:**
- Click row → project detail.
- `[+ New project]` opens a modal: `name, project_number, gc_name, architect_name`. `POST /projects`, redirects to project detail on success.

---

## Screen 3 — Project detail (Packages list) — light sketch

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Projects / Riverside Office Tower                       [Edit project] │
├──────────────────────────────────────────────────────────────────────────┤
│ Project #24-118   GC: Turner   Architect: SOM                            │
│                                                                          │
│  Packages                                          [+ New package]       │
│  ─────────────────────────────────────────────────────────────────────   │
│  [ Search by spec section or submittal #         ]                       │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 09 51 13-002  R1  Acoustical Ceiling Panels                        │  │
│  │ Status: Ready   8 items   Last updated 2h ago             [Open ▸] │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ 09 65 13-001  R0  Resilient Flooring                               │  │
│  │ Status: Exported   12 items   Exported yesterday          [Open ▸] │  │
│  ├────────────────────────────────────────────────────────────────────┤  │
│  │ 09 22 16-001  R0  Non-Structural Steel Framing                     │  │
│  │ Status: Draft   0 items                                   [Open ▸] │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

**New package modal:** `submittal_number, spec_section, revision (R0/R1/R2/...), title?, submittal_date?` → `POST /projects/:id/packages` → redirect to upload screen of the new package.

---

## Screen 4 — Upload + processing (light sketch)

Same URL as the package editor (`/packages/:id`) — the screen renders the upload state when `package.status === 'draft'` or `'processing'`.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Riverside / 09 51 13-002 R1   Acoustical Ceiling Panels    [Cover ▾]   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│           ┌───────────────────────────────────────────────────┐          │
│           │                                                   │          │
│           │      Drop PDFs here, or [ Browse files ]          │          │
│           │      Up to 20 files, 50 MB each                   │          │
│           │                                                   │          │
│           └───────────────────────────────────────────────────┘          │
│                                                                          │
│  Files (5)                                                               │
│  ─────────────────────────────────────────────────────────────────────   │
│  ▣ USG-Mars-ClimaPlus-cutsheet.pdf      ✓ Uploaded — Classifying…        │
│  ▣ USG-warranty-2026.pdf                ✓ Uploaded — Ready               │
│  ▣ USG-installation-guide.pdf           ⟳ 87%                            │
│  ▣ Armstrong-Optima-cutsheet.pdf        ⚠ OCR failed   [Retry]           │
│  ▣ Armstrong-installation.pdf           ✓ Uploaded — Extracting…         │
│                                                                          │
│  [ Cancel upload ]                                                       │
│                                                                          │
│  When all files finish processing, the table of contents will appear.   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Drag-drop or file picker. Each file gets a row immediately.
- Per file: presign → direct S3 PUT (progress bar) → confirm. When confirmed, `POST /packages/:id/process` (debounced once per package).
- Polls `GET /packages/:id/status` every 2 s. Per-PDF `processing_status` drives each row's badge.
- When `package.status === 'ready'`, the screen transitions to the **Package Editor** (Screen 5) — no navigation needed.

**Empty/error states:**
- File over 50 MB → inline error on that row, others continue.
- Whole-package processing failure → top banner "Processing hit an issue. [Retry] or contact support."

---

## Screen 5 — Package Editor (TOC review) — full, marquee

This is where the 10-minute promise is kept or broken. Single-pane list of items; expand a row to edit; slide-out drawer for citation preview.

### Collapsed state (default)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ← Riverside / 09 51 13-002 R1   Acoustical Ceiling Panels                            │
│                                          [Cover sheet ▾]  [Export package →]          │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  8 items   2 need review                       Sort: Spec section ▾   [+ Add item]   │
│  ─────────────────────────────────────────────────────────────────────────────────── │
│                                                                                      │
│  ⋮⋮  Product data  09 51 13                                                     ⋯   │
│       USG Mars ClimaPlus — Acoustical Ceiling Panel, 24×24                  [▾]      │
│       USG · Mars CMP-24 · 2 source PDFs                                              │
│  ─────────────────────────────────────────────────────────────────────────────────── │
│  ⋮⋮  Product data  09 51 13   ⚠ 2 fields need review                           ⋯   │
│       Armstrong Optima — Acoustical Ceiling Panel, 24×24                    [▾]      │
│       Armstrong · OPT-24-WH · 1 source PDF                                           │
│  ─────────────────────────────────────────────────────────────────────────────────── │
│  ⋮⋮  Warranty  09 51 13                                                         ⋯   │
│       USG Mars ClimaPlus — 30-year limited warranty                         [▾]      │
│       USG · 1 source PDF                                                             │
│  ─────────────────────────────────────────────────────────────────────────────────── │
│  ⋮⋮  Installation  09 51 13                                                     ⋯   │
│       USG Mars ClimaPlus — Installation guide                               [▾]      │
│       USG · 1 source PDF                                                             │
│  ─────────────────────────────────────────────────────────────────────────────────── │
│   …                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Anatomy of a collapsed row:**

```
⋮⋮  [doc type chip]  [spec section]   [⚠ N fields need review (if any)]   ⋯
     [Item title]                                                       [▾]
     [Manufacturer · Model · N source PDFs]
```

- **`⋮⋮`** — drag handle. Drag to reorder. Reorder fires `POST /packages/:id/items/reorder` once on drop.
- **Doc type chip** — clickable; opens a small dropdown to reclassify (`PATCH /items/:id { doc_type }`). Preserves `doc_type_original_ai_value` server-side.
- **⚠ chip** — only appears when one or more attributes have `confidence < 0.7` and haven't been edited. Disappears once the user edits or confirms.
- **`⋯`** — overflow menu: Remove from TOC, Move to another package (future), View source PDFs.
- **`[▾]`** or click anywhere on the title → expand the row.

### Expanded state (one row, others stay collapsed)

```
  ⋮⋮  Product data ▾   09 51 13                                              ⋯ [▴]
       Armstrong Optima — Acoustical Ceiling Panel, 24×24
       Armstrong · OPT-24-WH · 1 source PDF
       ┌────────────────────────────────────────────────────────────────────┐
       │ Title           [ Armstrong Optima — Acoustical Ceiling Panel … ]  │
       │ Manufacturer    [ Armstrong                                     ]  │
       │ Model #         [ OPT-24-WH                            ]  ⚠ low   │
       │                   ↳ AI suggested "OPT-24-WH"   [Revert]   p. 3 ↗  │
       │ Description     [ Mineral fiber acoustical ceiling panel, …    ]  │
       │ Spec section    [ 09 51 13                ]  p. 1 ↗                │
       │                                                                    │
       │ Source PDFs                                                        │
       │  • Armstrong-Optima-cutsheet.pdf  12 pp  [Open ↗]  [Detach]        │
       │                                                                    │
       │ [ Delete item ]                              [ Mark reviewed ✓ ]   │
       └────────────────────────────────────────────────────────────────────┘
```

**Field anatomy:**
- Inline-editable input. `PUT /items/:id/attributes/:key { value }` on blur.
- `⚠ low` chip — only on attributes with `confidence < 0.7` and `edited_by_user_at IS NULL`.
- `↳ AI suggested "…"` + `[Revert]` — shown only when `current_value !== original_ai_value`. Revert calls `POST /items/:id/attributes/:key/revert`.
- `p. N ↗` — click opens the **Citation drawer** (below). Click target is the whole "p. N ↗" affordance; cmd/ctrl-click opens in a new tab.
- `[Mark reviewed ✓]` — sets every attribute on this item to edited (even if value unchanged), clears `⚠` chips. Stamps `edited_by_user_at = now()`. Convenience for "I looked at this and the AI was right."

**Keyboard:**
- `↑ / ↓` — move between rows.
- `Enter` — expand/collapse focused row.
- `Tab` — move between fields within expanded row.
- `Esc` — collapse current row; if drawer is open, close drawer first.

### Citation drawer (right slide-out)

Opens when the user clicks a `p. N ↗` link. Overlays the right ~40% of the screen; main list remains scrolled to the active row.

```
                                              ┌─────────────────────────────┐
                                              │ ✕ Armstrong-Optima-cutsheet │
                                              │   Page 3 of 12              │
                                              │ ─────────────────────────── │
                                              │                             │
                                              │   ┌─────────────────────┐   │
                                              │   │                     │   │
                                              │   │   [rendered page    │   │
                                              │   │    image of p. 3]   │   │
                                              │   │                     │   │
                                              │   │                     │   │
                                              │   └─────────────────────┘   │
                                              │                             │
                                              │   [◂ Prev]  3/12  [Next ▸]  │
                                              │                             │
                                              │   OCR text                  │
                                              │   ┌─────────────────────┐   │
                                              │   │ Model OPT-24-WH     │   │
                                              │   │ White ceiling panel │   │
                                              │   │ 24" × 24" × 5/8"    │   │
                                              │   │ …                   │   │
                                              │   └─────────────────────┘   │
                                              │                             │
                                              │   [Open full PDF ↗]         │
                                              └─────────────────────────────┘
```

- API: `GET /source-pages/:id/preview` returns rendered image URL + OCR text.
- Prev/Next walk through pages of the same source PDF.
- `[Open full PDF ↗]` → `GET /source-pdfs/:id/download`, opens in a new tab.
- `Esc` closes the drawer and returns focus to the field.

### Top-of-page interactions

- **`[Cover sheet ▾]`** — opens cover sheet form (Screen 6) as a slide-down or modal.
- **`[Export package →]`** — only enabled when no items have `⚠` flags AND every item has at least `doc_type`, `title`, `manufacturer`, `model_number`. Disabled tooltip explains what's missing.
- **`Sort:`** — Spec section (default), Doc type, Manual order, Date added. Switching sort updates `sort_order` locally; user can also manually drag.

### States

- **Empty (post-upload, AI returned nothing):** "AI couldn't extract enough info from these PDFs. [Add item manually]." Lets the user build TOC from scratch.
- **Processing in progress (returning user):** show the upload/processing screen instead.
- **Read-only (after export):** banner "This package has been exported. [Create new revision (R1)] to make changes." Edits are blocked.

---

## Screen 6 — Cover sheet form — light sketch

Slide-down panel from the top of the editor (preserves context) or full modal. One form, save-on-blur.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Cover sheet                                              [✕]              │
│ ─────────────────────────────────────────────────────────────────────── │
│  Project name        [ Riverside Office Tower               ]            │
│  Project number      [ 24-118                                ]            │
│  GC                  [ Turner                                ]            │
│  Architect           [ SOM                                   ]            │
│  ─────────────────────────────────────────────────────────────────────── │
│  Submittal #         [ 09 51 13-002                          ]            │
│  Spec section        [ 09 51 13                              ]            │
│  Revision            [ R1 ▾ ]                                            │
│  Date                [ 2026-05-13                            ]            │
│  Title               [ Acoustical Ceiling Panels             ]            │
│  ─────────────────────────────────────────────────────────────────────── │
│  Sub company         [ Cooper Interiors                      ]  default  │
│  Logo                [ cooper-logo.png ▸ ]   [Replace]   [Remove]        │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │            [ Live preview of cover sheet page 1 ]                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

- Project fields are read-only here; "Edit project metadata" link → project detail screen.
- Sub company / logo defaults from workspace; per-package override is **out of scope at MVP** per data model — show defaults, point to Settings to change.
- Live preview is a static SVG/canvas rendering, not a fetched PDF.
- API: `PATCH /packages/:id` for all editable fields.

---

## Screen 7 — Export preview / status — full

Triggered by `[Export package →]` in the editor. Two phases: pre-export confirmation + rendering progress + ready-to-download.

### Phase A — confirmation

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Export package                                              [✕]           │
│ ─────────────────────────────────────────────────────────────────────── │
│                                                                          │
│  Riverside Office Tower / 09 51 13-002 R1                                │
│  Acoustical Ceiling Panels                                               │
│                                                                          │
│  This package will include:                                              │
│   • Cover sheet (1 page)                                                 │
│   • Table of contents with page citations (~2 pages)                     │
│   • 8 items, 47 source pages                                             │
│   • Bates-style numbering on every page                                  │
│   • PDF bookmarks per item                                               │
│                                                                          │
│  Bates prefix (optional)   [ 09-51-13-002-R1-               ]            │
│                                                                          │
│  Heads up:                                                               │
│   • 2 items have low-confidence fields you haven't reviewed.    [View]  │
│                                                                          │
│  [Cancel]                                       [ Render package → ]     │
└──────────────────────────────────────────────────────────────────────────┘
```

- Warnings (not blockers): unreviewed low-confidence fields, missing common attributes.
- Hard blockers (button disabled): no items, item with no source PDFs.

### Phase B — rendering

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Rendering package…                                                       │
│ ─────────────────────────────────────────────────────────────────────── │
│                                                                          │
│   ⟳   Assembling 47 source pages with cover, TOC, bookmarks,             │
│       and Bates numbering.                                               │
│                                                                          │
│   [████████████░░░░░░░░░░░] 60%                                          │
│                                                                          │
│   This usually takes 10–30 seconds. You can leave this screen and       │
│   come back — we'll save the export.                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Polls `GET /exports/:id` every 2 s.

### Phase C — ready

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ✓ Package ready                                                          │
│ ─────────────────────────────────────────────────────────────────────── │
│                                                                          │
│   Riverside / 09 51 13-002 R1                                            │
│   Acoustical Ceiling Panels.pdf                                          │
│   50 pages · 12.4 MB · rendered just now                                 │
│                                                                          │
│         ┌─────────────────────────────────────────────┐                  │
│         │                                             │                  │
│         │   [ embedded PDF preview, first page ]      │                  │
│         │                                             │                  │
│         └─────────────────────────────────────────────┘                  │
│                                                                          │
│   [Download PDF]      [Re-render]      [Back to editor]                  │
│                                                                          │
│   Previous exports                                                       │
│   ─────────────────────────────────────────────────────────────────────  │
│   • R1, just now (12.4 MB)                                  [Download]   │
│   • R0, exported 2 days ago (11.9 MB)                       [Download]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- `[Download PDF]` follows the presigned URL from `GET /exports/:id/download`.
- Previous exports list comes from `GET /packages/:id/exports`. Persisting every render means re-download is always available even after R1, R2 etc.
- `[Re-render]` is greyed for 60 s after success to discourage spam re-renders.

---

## Cross-cutting UX

- **Persistent header bar:** workspace name, breadcrumb (Projects / Project / Package), user menu.
- **Toast notifications:** save success, processing complete, export ready. Top-right, auto-dismiss 3 s.
- **Optimistic updates:** title/field edits update the row immediately; server failure rolls back with a toast.
- **Loading skeletons** on first paint of list endpoints; not spinners.
- **Browser tab title** reflects the current package's submittal_number + revision when on the editor — helps PMs who keep 3+ tabs open.
- **Unsaved changes guard:** beforeunload prompt only when there's an in-flight edit (rare given save-on-blur, but cheap insurance).
- **Mobile:** brief explicitly excludes mobile at MVP. Layouts target 1280 px+; ≤1024 px shows a "this tool is designed for desktop" banner rather than reflowing.

## Screen-to-API map (sanity)

| Screen | Primary endpoints |
|---|---|
| Dashboard | `GET /projects` |
| Project detail | `GET /projects/:id` (with packages) |
| New project / new package modal | `POST /projects`, `POST /projects/:id/packages` |
| Upload + processing | presign / S3 PUT / confirm × N, `POST /packages/:id/process`, `GET /packages/:id/status` (poll) |
| Package editor | `GET /packages/:id`, `GET /packages/:id/items`, `PATCH /items/:id`, `PUT /items/:id/attributes/:key`, `POST .../revert`, `POST /packages/:id/items/reorder`, `GET /source-pages/:id/preview` |
| Cover sheet | `PATCH /packages/:id`, workspace logo endpoints if defaulting |
| Export | `POST /packages/:id/exports`, `GET /exports/:id` (poll), `GET /exports/:id/download`, `GET /packages/:id/exports` |

Every screen interaction is covered by Step 5's contract. No gaps.

## Verification

Before approving Step 7 (stack lock-in):

1. **Walk a real flow** with these wireframes on paper or in Figma — pretend to be a PM with 12 PDFs. Time yourself clicking through every state. If the editor takes more than ~5 min to mentally process a typical package, the layout's wrong.
2. **Check the citation loop.** From a single low-confidence field, count clicks to (a) verify the source, (b) edit the value, (c) move to the next row. Should be ≤3 clicks plus ≤1 keystroke.
3. **Confirm states are enumerated.** For each screen, list: empty, loading, error, success, read-only-after-export. Any missing state = a build-time scramble later.
4. **Map every interaction to an API call** in Screen-to-API table above. Any UI affordance that doesn't have a corresponding endpoint = bug in Step 5 or scope creep in Step 6.

## What's next

Step 7 — stack lock-in. The leading candidate from brief §10 is Next.js + Postgres + S3 + worker queue + Anthropic vision model. Step 7 commits to specific libraries (PDF assembly, OCR, queue) and deployment target.
