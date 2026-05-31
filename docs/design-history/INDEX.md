# Design History Index

> This directory is a frozen archive of design and build decisions for
> Submittal Builder. Files are not actively maintained — they document
> the reasoning and state at the time each decision was made.
>
> **For an agent:** read this index to find relevant context. Files marked
> **CURRENT** describe the system as-built. Files marked **HISTORICAL**
> captured decisions or state that may have drifted since the build completed.

## Quick lookup

| Looking for... | Read |
|---|---|
| Data model (tables, enums, audit fields) | [`data-model.md`](data-model.md) |
| REST API endpoint shapes | [`api-contract.md`](api-contract.md) (spec) or [`step-8-final-handoff.md`](step-8-final-handoff.md) (as-built) |
| UI wireframes / UX spec | [`wireframes.md`](wireframes.md) |
| Technology choices | [`step-7-stack-lockin.md`](step-7-stack-lockin.md) |
| Backend surface for frontend work | [`step-8-final-handoff.md`](step-8-final-handoff.md) |
| What a specific backend phase built | `step-8-phase-{0-6}-handoff.md` |
| What a specific UI phase built | `ui-phase-{1-9}-handoff.md` |
| MVP scope and product vision | [`product-brief.md`](product-brief.md) |

## File catalog

### Product specification

| File | Content | Status |
|---|---|---|
| [`product-brief.md`](product-brief.md) | MVP vision, scope, competitive positioning, critical user flow | HISTORICAL |
| [`data-model.md`](data-model.md) | Relational schema: 13 tables, enums, audit fields, V1.1 placeholders | CURRENT |
| [`phase-0-sample-pdfs.md`](phase-0-sample-pdfs.md) | URLs for the 3 test fixture PDFs used in spikes | REFERENCE |

### Risk spikes

| File | Content | Status |
|---|---|---|
| [`spike-pdf-pipeline-SNAPSHOT.md`](spike-pdf-pipeline-SNAPSHOT.md) | Proof that pdfjs-dist + pdf-lib can assemble submittal PDFs (33 pages, bookmarks, Bates stamps) | COMPLETED |
| [`spike-ai-classify-extract-SNAPSHOT.md`](spike-ai-classify-extract-SNAPSHOT.md) | Proof that Claude Sonnet achieves 100% doc-type classification, 93% attribute extraction | COMPLETED |

### Architecture decisions

| File | Content | Status |
|---|---|---|
| [`api-contract.md`](api-contract.md) | REST API surface: endpoints, auth, tenancy, pagination, polling | CURRENT |
| [`wireframes.md`](wireframes.md) | Structural wireframes for all screens in the critical user flow | CURRENT |
| [`step-7-stack-lockin.md`](step-7-stack-lockin.md) | Technology choices: Next.js 15, Drizzle, Neon, S3, Fly, pg-boss, Claude Sonnet, Textract | CURRENT |

### Backend build

| File | Content | Status |
|---|---|---|
| [`step-8-buildplan.md`](step-8-buildplan.md) | Master phased build plan (phases 0-6), sequencing rationale | HISTORICAL |
| [`step-8-phase-0-handoff.md`](step-8-phase-0-handoff.md) | Spikes executed, service provisioning, env matrix | HISTORICAL |
| [`step-8-phase-1-handoff.md`](step-8-phase-1-handoff.md) | Monorepo scaffold, Drizzle schema, better-auth, tenancy helper | HISTORICAL |
| [`step-8-phase-2-handoff.md`](step-8-phase-2-handoff.md) | Projects / packages / items CRUD, Zod API schemas | HISTORICAL |
| [`step-8-phase-3-handoff.md`](step-8-phase-3-handoff.md) | S3 presign/confirm, PDF text parsing, page preview rendering | HISTORICAL |
| [`step-8-phase-4-handoff.md`](step-8-phase-4-handoff.md) | Worker boot, pg-boss jobs, Anthropic + Textract integration | HISTORICAL |
| [`step-8-phase-5-handoff.md`](step-8-phase-5-handoff.md) | Audit-aware item edits, export rendering (cover + TOC + merge + Bates) | HISTORICAL |
| [`step-8-phase-6-handoff.md`](step-8-phase-6-handoff.md) | Observability, Sentry, healthz endpoints, admin queries | HISTORICAL |
| [`step-8-final-handoff.md`](step-8-final-handoff.md) | **Authoritative backend surface** — every endpoint, Zod schema locations, polling cadence, env vars | CURRENT |

### UI build

| File | Content | Status |
|---|---|---|
| [`ui-phase-1-handoff.md`](ui-phase-1-handoff.md) | Auth screens, dashboard (projects list) | HISTORICAL |
| [`ui-phase-2-handoff.md`](ui-phase-2-handoff.md) | Project detail, package creation modal | HISTORICAL |
| [`ui-phase-3-handoff.md`](ui-phase-3-handoff.md) | Upload + processing screen, drag/drop, progress bars | HISTORICAL |
| [`ui-phase-4-handoff.md`](ui-phase-4-handoff.md) | Package editor: item list, doc-type reclassify, attribute edit, drag-to-reorder | HISTORICAL |
| [`ui-phase-5-handoff.md`](ui-phase-5-handoff.md) | Cover sheet form, logo preview | HISTORICAL |
| [`ui-phase-6-handoff.md`](ui-phase-6-handoff.md) | Export flow (confirmation, rendering progress, download) | HISTORICAL |
| [`ui-phase-7-handoff.md`](ui-phase-7-handoff.md) | Workspace settings, company name, logo upload | HISTORICAL |
| [`ui-phase-8-handoff.md`](ui-phase-8-handoff.md) | "+ Add item" button, worker race condition fix | HISTORICAL |
| [`ui-phase-9-handoff.md`](ui-phase-9-handoff.md) | "Processing complete" interstitial | HISTORICAL |
