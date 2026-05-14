# Submittal Builder — Pre-MVP Research Report

**Status:** Draft for user review before locking Step 1 (Define the MVP outcome).
**Date:** 2026-05-12
**Working directory:** `C:\Repos\submittal-builder` (empty — greenfield)
**Source:** `C:\Repos\path to MVP.md` (12-step MVP roadmap)

---

## 1. Context: What this product is

A focused, AI-native tool that takes a pile of PDFs a subcontractor was just emailed by manufacturers and reps, and assembles them into a reviewer-ready **submittal package**: cover sheet, table of contents with page references, bookmarks, page numbering, and a single combined PDF.

The wedge is sharp: **kill the 2–6 hours a sub or PM spends in Acrobat every time a submittal goes out**. Workflow, routing, and approvals are out of scope — competitors (Procore, Newforma, Submittal Exchange) already own that and don't touch the assembly problem.

---

## 2. How submittals actually work (the process you're attacking)

A short primer so the design decisions below have grounding:

1. Sub wins a scope (e.g., Division 09 - Finishes).
2. Spec section dictates what must be submitted per item — typically some combination of: **product data / cut sheet, shop drawings, samples, SDS, warranty, installation instructions, test reports, LEED docs, O&M data**.
3. Sub emails manufacturers / reps → gets back a chaotic pile of PDFs (some cut sheets cover 12 products when the sub only uses 1; some are scans without OCR; some are duplicates).
4. Sub manually assembles in Acrobat: reorder, add cover sheet, type a TOC, add bookmarks, Bates-number pages, highlight which options on the cut sheet apply ("Model 4500-A, Color White, Wall Mount").
5. Sub submits to GC under a numbering scheme tied to spec sections (e.g., `09 51 13-001`, revision `R0`).
6. Reviewer (GC → architect → engineer) marks **Approved / Approved as Noted / Revise & Resubmit / Rejected**.
7. On rejection or noted changes, sub resubmits as `R1`, `R2`. Revision history matters.

The **package itself is a legal-ish artifact** — engineers stamp shop drawings, architects stamp approvals, and the document is referenced for the life of the project ("see submittal 09 51 13-002, page 47"). Implication: **accuracy and traceability are non-negotiable**, and the original manufacturer PDF bytes must never be altered, only assembled, annotated, and stamped around.

---

## 3. Where AI fits — and why

| Capability | AI fit | Why |
|---|---|---|
| **Classify each PDF** (product data vs. shop drawing vs. SDS vs. warranty) | **Strong** | Vision + LLM excel at document type classification with visual+textual cues. Massive time saver. |
| **Extract product attributes** (manufacturer, model #, spec section reference, description) | **Strong** | This is the TOC content. LLM with vision is purpose-built for this. |
| **Split multi-product PDFs into per-product sections** | **Strong-but-risky** | Catalogs often bundle 50 products on 200 pages. AI can detect page boundaries; needs confidence scores + human review UI. |
| **Order sections by CSI MasterFormat spec number** | **Strong** | Once spec refs are extracted, ordering is deterministic. |
| **Generate TOC entries in natural language** | **Strong** | "ACT-1 Acoustical Ceiling Panel, USG Mars ClimaPlus, 24x24" — perfect LLM task. |
| **Suggest which option on a cut sheet to highlight** (future) | **Medium** | Needs the spec doc + the cut sheet; doable but accuracy-critical. |
| **Flag out-of-spec items** (your roadmap V2 feature) | **Medium-Strong** | Cross-document reasoning over spec section text + product data. This is the killer V2 feature. |
| **Detect missing required submittals** (spec requires warranty, none uploaded) | **Strong** | Spec parsing + checklist diff. Big differentiator. |
| **Deduplicate near-identical PDFs** | **Medium** | Hashing for exact dupes is trivial; semantic dedup (two MSDS revisions) needs care. |

## 4. Where AI does NOT fit — and why

| Anti-pattern | Why to keep AI out |
|---|---|
| **Generating/replicating engineer or architect stamps** | Professional stamps are legally regulated. Never touch. |
| **Making the approval decision** | Architect/engineer is the legal reviewer. Tool surfaces info; humans approve. |
| **Editing manufacturer PDF content** | Cut sheets are evidence. Annotate around them, never alter bytes. Burden of proof if challenged. |
| **Inferring values without a citation back to a page** | Every AI-extracted field in the TOC must link to the source page. No floating claims. |
| **Auto-submitting without human verification gate** | One mislabeled fire-rating could kill someone. Always a "review before export" step. |
| **Generating shop drawings** | These come from fab shops with CAD. Out of scope. |
| **Determining structural / engineering values** | Calc'd by licensed PEs. Not our lane. |

**Design principle that falls out of this:** every AI output must be (a) cited to a source page, (b) confidence-scored or at minimum reviewable, and (c) one-click correctable by the human in the loop. The product is "AI does the typing, human does the verifying" — not "AI submits the package."

---

## 5. Features I'd suggest you didn't list

Sorted by how much they sharpen the wedge. Not all are MVP — flagged accordingly.

### Likely MVP (would feel broken without them)

1. **PDF bookmarks in the output PDF**, one per TOC entry. Reviewers navigate by bookmark pane — a TOC without bookmarks is half the product.
2. **Bates-style sequential page numbering** stamped on every page. Reviewers say "see page 47" — must work without ambiguity. Original page numbers stay too.
3. **Spec section field on every item** (CSI MasterFormat code like `09 51 13`). Drives TOC ordering and is the primary cross-reference in the construction industry.
4. **Submittal metadata block** on the cover sheet: project name, project number, sub company, GC, architect, spec section, submittal number, **revision (R0/R1/R2)**, date. Not just "your logo and company info."
5. **Page-citation for every TOC item** — already implied by your design, but worth stating: the TOC entry links to the *first page* of that item in the assembled PDF.
6. **Manual reorder + manual reclassify UI** — when the AI gets it wrong (and on construction docs, it sometimes will), the user needs drag-to-reorder and a dropdown to fix the doc type without re-uploading.
7. **Approval/stamp block on the cover sheet** (empty boxes for GC stamp, architect stamp). Standard expectation.

### Strong V1.1 (right after MVP)

8. **Split-PDF support** — when a manufacturer catalog covers 12 products and the sub only uses 2, the tool needs to let the user (with AI assist) carve out just the relevant pages. Without this, packages bloat with irrelevant pages and reviewers complain.
9. **Highlight/circle/callout tool** for marking which option on a cut sheet applies. ("Model 4500-A, Color: White.") This is how subs communicate intent today; doing it elsewhere defeats the tool.
10. **Save & reuse cover/TOC templates per project** — a sub doing 30 submittals on the same project enters the project metadata once.
11. **Revision handling** — clone a prior submittal, mark it `R1`, optionally diff against `R0` so the reviewer sees what changed. Resubmittals are ~30% of all submittals.
12. **Missing-document checklist** — given the spec section, flag "you're missing the warranty" before export.
13. **Transmittal letter generator** — a separate one-page letter that often goes on top of the cover sheet.

### V2 (post-launch, but worth designing toward)

14. **Spec compliance check** (your roadmap item) — upload the project spec doc, AI flags products that don't meet requirements. Killer feature, requires V1 to be rock solid first.
15. **Spec section coverage report** — "the spec calls for items in sections 09 51 13, 09 65 13, 09 91 23 — you've only assembled 09 51 13."
16. **Template library** by trade/division — electrical subs submit similar packages over and over.
17. **Project workspace** — multiple submittals per project, project-level metadata.
18. **Multi-user / team review** — one sub assembles, PM reviews before sending to GC.
19. **Export formats**: single PDF (primary), PDF + Excel TOC (some GCs require), zipped per-section PDFs.
20. **Audit log** — what the AI inferred vs. what the human edited. Useful for confidence calibration and, if a dispute ever arises, traceability.

### Cross-cutting concerns (think about now, even if not built now)

- **Data residency / no-training guarantee** — submittals contain proprietary product info and sometimes project plans for sensitive buildings (data centers, gov, healthcare). The buyer's IT will ask.
- **Original-bytes preservation** — never re-encode manufacturer PDFs. Merge by reference where possible. (Affects PDF library choice.)
- **OCR pipeline** — many manufacturer PDFs are scans. Without OCR, the AI can't read them and Bates-search breaks.
- **Confidence + citations** baked into the data model from day one — retrofitting is painful.

---

## 6. Competitive read

- **Procore Submittals / Submittal Exchange / Newforma** — own *workflow* (routing, approvals, status tracking). Don't help you build the package.
- **Adobe Acrobat Pro** — the actual incumbent. Manual. Slow. No AI.
- **PlanGrid / Autodesk Build** — adjacent, again workflow-focused.

The gap is real: nobody focuses on **AI-powered assembly**. That's your wedge, and it's defensible because the document-understanding pipeline (PDF classification, attribute extraction, multi-product splitting, citation linking) takes work to get right.

---

## 7. Step 1 — MVP outcome (LOCKED)

**Target user.** A subcontractor PM or project engineer who assembles 5–30 submittals per project. Today they use Acrobat manually, spending 1–4 hours per package. Solo operator per workspace at MVP.

**Core job.** Turn a pile of uploaded PDFs (typically 5–20 source files, output 50–200 pages) into a single reviewer-ready submittal package — cover sheet, table of contents with page citations, bookmarks, sequential page numbering — **in under 10 minutes**.

**Success metric for MVP launch.** A pilot subcontractor PM can take a real (not synthetic) submittal package from upload to GC-ready export in under 10 minutes, with the TOC accurate enough that they don't need to fall back to Acrobat for corrections.

**Done state per package (user POV):**
1. User uploads a set of manufacturer PDFs.
2. AI classifies each PDF (product data, shop drawing, SDS, warranty, installation, etc.), extracts manufacturer/model/description, and identifies CSI spec section refs.
3. AI proposes an ordered TOC; user reviews, drag-reorders, edits fields, fixes misclassifications.
4. User fills cover sheet metadata (project, sub, GC, architect, spec section, submittal #, revision).
5. User exports a single PDF with cover sheet, TOC linked to pages, PDF bookmarks per item, and Bates-style page numbering.

**Form factor.** Web app, cloud processing. Standard SaaS terms.

**Explicit non-goals at MVP:**
- Approval workflow / routing / e-signatures
- GC or architect personas
- Multi-user / team collaboration / permissions
- Spec compliance checking (V1.1 — see below)
- Multi-product PDF splitting (V1.1)
- Highlight/callout markup on cut sheets (V1.1)
- Template library beyond per-project reuse
- Mobile / tablet
- Desktop app or Acrobat plug-in
- On-prem deployment

**Decisions that shape later steps (forward-looking, not built at MVP):**
- **V1.1 headline is spec compliance** (within ~3 months of MVP). Implication: the data model must hold spec docs and per-item attributes from day one; the AI pipeline must produce structured, machine-readable item records (not just rendered TOC text).
- **Citations are first-class.** Every AI-extracted attribute carries a `source_page` reference and a confidence score. Non-negotiable for V1.1 spec checks and for reviewer trust.
- **Original PDF bytes are preserved.** Annotation and assembly only; no re-encoding of manufacturer content.

---

## 8. Step 2 — Critical user flow (LOCKED)

Shortest successful path from "I just got 12 PDFs in an email" to "package is ready to send."

```
1. Create package (project + spec section + submittal #)
       ↓
2. Drag/drop or upload PDFs (5–20 files)
       ↓
3. AI ingest pipeline runs:
     - OCR if scanned
     - Classify document type
     - Extract manufacturer, model, description, spec ref
     - Group multi-file products together
     - Propose ordered TOC
       ↓
4. Review & edit screen:
     - Drag to reorder items
     - Inline-edit any TOC field
     - Reclassify document type (dropdown)
     - Remove unwanted files
     - Each AI field shows confidence + source page link
       ↓
5. Cover sheet form:
     - Project name, # | Sub company + logo | GC | Architect
     - Spec section | Submittal # | Revision (R0/R1/R2) | Date
     - Empty approval-stamp block
       ↓
6. Export:
     - Single combined PDF
     - Cover sheet (page 1)
     - TOC (pages 2–N) with page-number citations
     - Source PDFs in order, each with a bookmark
     - Bates-style sequential numbering on every page
       ↓
7. Download. Done.
```

**The 10-minute budget breaks down roughly as:** 1 min upload, 2–3 min AI processing (async, can step away), 4–5 min human review/edit, 1 min cover sheet, <1 min export. The product wins or loses on step 4.

---

## 9. Step 3 — Scope and non-goals (LOCKED)

**IN scope for MVP:**

| Area | Included |
|---|---|
| Auth | Single user account per workspace; email + password login |
| Project | Lightweight project entity (name, number, GC, architect); reused metadata across packages |
| Package | Create, edit, delete; one package = one submittal |
| Upload | Drag/drop, multi-file, PDF only, ~50MB/file ceiling |
| OCR | Auto-applied on scanned/image PDFs |
| AI classify | Doc type (product data / shop drawing / SDS / warranty / installation / test report / other) |
| AI extract | Manufacturer, model #, description, CSI spec section ref (if present) |
| AI order | Sort by CSI spec number, then by user-defined tiebreaker |
| TOC editor | Drag-reorder, inline-edit fields, reclassify, delete, show confidence + source page |
| Cover sheet | Template with editable fields + logo upload; clean modern default |
| Export | Single PDF: cover + TOC + bookmarks + Bates numbering; preserves original PDF bytes |
| Storage | Cloud; per-user file storage with packages persisted for re-export |

**OUT of scope for MVP (deferred):**

| Area | Deferred to | Reason |
|---|---|---|
| Spec compliance checking | V1.1 (~3 months post-launch) | Headline V1.1 feature — needs MVP foundation first |
| Multi-product PDF splitting | V1.1 | Important but adds significant UI/AI complexity |
| Highlight/callout markup on cut sheets | V1.1 | Critical for full workflow; deferred to keep MVP scope |
| Missing-document checklist | V1.1 (rides on spec parsing) | Requires spec doc ingestion |
| Revision diff (R0 vs R1) | V1.1 | Revision *field* is in MVP; diff UI is not |
| Template library (per trade) | V1.2 | Per-project reuse is enough at MVP |
| Team collaboration | V2 | Solo at MVP per user decision |
| Approval workflow / routing | Never (out of scope philosophically) | Competitors own this; we don't enter |
| Mobile, desktop, plug-in | Never (at least not at MVP) | Web-first |

---

## 10. Open architectural decisions for Steps 4–7

Flagging now so Step 4 (data model) onward can be tackled cleanly:

- **Stack.** Web app, cloud, AI-native. Likely candidates: Next.js + Postgres + S3-compatible storage + a worker queue for AI processing. PDF handling: a server-side library that preserves original bytes (pdf-lib for assembly + pdfcpu or qpdf for advanced ops). OCR via cloud service. LLM via Anthropic API (vision-capable model for classification + extraction).
- **AI pipeline shape.** Per-PDF: OCR → vision classify → structured extract → emit item record with citations + confidence. Batch step: dedupe, group, order. All outputs stored as structured records so V1.1 spec compliance can reason over them.
- **Data model preview** (to be detailed in Step 4): `User` → `Project` → `Package` → `Item` (one per logical TOC entry) → `SourcePage` (link back to original PDF + page). `SpecDocument` table reserved for V1.1.

These are previews, not commitments. Step 4 will lock them.

---

## 11. What's next (after you approve Steps 1–3)

- **Step 4: Data model** — entity diagram, key fields, the citation/confidence shape.
- **Step 5: API / system contract** — the handful of endpoints needed (upload, process, list items, update item, export).
- **Step 6: Wireframes** — three screens: dashboard/projects, package editor, export preview.
- **Step 7: Stack lock-in.**

I'll stop again after Step 5 before any wireframes or code.
