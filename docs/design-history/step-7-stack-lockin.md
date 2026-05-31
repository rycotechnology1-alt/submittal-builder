# MVP Stack Lock-In — Submittal Builder (Step 7)

## Context

Steps 4–6 settled the data model, API contract, and screens. Step 7 commits to concrete libraries, services, and deployment targets so build (Steps 8+) can start without further architectural debate.

**Confirmed via clarifying questions:** TypeScript everywhere; managed OCR (AWS Textract); Vercel (web) + Fly.io (worker) + Neon (Postgres) + S3 (blobs); pg-boss for queueing.

**Decision principles:**

1. **Best-in-class per layer, not best-in-class everywhere.** Multi-vendor is fine when each piece is replaceable; the integration cost is low and the lock-in cost is lower.
2. **Single language, single repo at MVP.** TS end-to-end. Optimize for one operator shipping fast.
3. **Reuse Postgres for everything that can live there** (auth sessions, queue, structured data). One datastore is cheaper to operate than three.
4. **Defer scaling decisions until they bite.** pg-boss is fine until it isn't; Vercel is fine until workers grow; swap when the pain is real.

---

## 1. Languages & runtimes

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.x, `strict: true` | One language top to bottom. |
| Web framework | **Next.js 15** (App Router) | API routes for the REST contract, Server Components for read-heavy pages (dashboard, project detail), Client Components for the editor. |
| Worker runtime | Node 20 LTS, plain TS process | No framework — just a pg-boss-driven script. |
| Package manager | **pnpm** + workspaces | Fast, deterministic; ready for monorepo if it grows. |

**Repo layout** (single repo, two deploy targets):

```
/apps
  /web       Next.js app (Vercel)
  /worker    Node worker (Fly.io)
/packages
  /db        Drizzle schema + migrations + client
  /shared    Zod schemas, types, AI prompts, PDF utils
/infra       Deployment configs (vercel.json, fly.toml)
```

`packages/shared` is the contract surface — anything the web and worker both need (Zod schemas mirroring the API contract, attribute keys, doc-type enums, prompt templates).

## 2. Database & ORM

| Concern | Choice |
|---|---|
| Postgres | **Neon** (managed, branching for staging/PR previews) |
| ORM | **Drizzle ORM** + `drizzle-kit` for migrations |
| Connection pooling | Neon's pooled URL for serverless (web); direct URL for worker |
| Migrations | SQL migrations checked into `/packages/db/migrations`, applied via `drizzle-kit migrate` in CI before deploy |

**Why Drizzle over Prisma:** plays well with Neon's serverless driver, no separate query engine to bundle, schema-as-TS matches our normalized model 1:1.

**Schema location:** Step 4's tables map directly to `/packages/db/schema.ts`. Postgres enums are first-class (`pgEnum` in Drizzle).

## 3. Auth

| Concern | Choice |
|---|---|
| Library | **better-auth** (TS, plugin-based, Drizzle-compatible) |
| Storage | Sessions in Postgres (a `sessions` table; not in Step 4's model — added here) |
| Cookies | HTTP-only, `Secure`, `SameSite=Lax`, 30-day rolling |
| Password hash | argon2id |
| CSRF | better-auth's built-in CSRF token, sent via `X-CSRF-Token` per Step 5 |

No third-party auth provider at MVP. Roll-our-own is fine for email/password; better-auth removes the foot-guns.

## 4. Object storage & uploads

| Concern | Choice |
|---|---|
| Provider | **AWS S3**, single bucket per environment |
| Region | `us-east-1` (same region as Textract to avoid egress) |
| Bucket layout | `workspaces/{workspace_id}/source_pdfs/{source_pdf_id}.pdf`, `.../page_previews/{source_page_id}.webp`, `.../exports/{export_id}.pdf` |
| SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| Presigned URL TTL | 15 min for upload, 5 min for download |
| Encryption | SSE-S3 (default); no per-object key complexity at MVP |
| CORS | Allow PUT from the web origin for direct browser uploads |

## 5. PDF pipeline

The core of the product. Every operation must preserve manufacturer bytes.

| Step | Library | Notes |
|---|---|---|
| Parse text-native PDFs | **`pdfjs-dist`** (Node build) | Extracts text + page metadata without OCR. First pass before falling back to Textract. |
| Detect scanned/image pages | Heuristic: text length < 50 chars per page → mark for OCR | |
| OCR | **AWS Textract** `DetectDocumentText` (async via `StartDocumentTextDetection` for >5 pages) | Returns blocks with bounding boxes; we store the flat text in `source_pages.ocr_text` and the raw response in S3 for future re-use. |
| Page-image rendering for citation drawer | **`pdfjs-dist`** rasterizer → WebP, cached in S3 | Rendered lazily on first citation click; cache key `source_page_id`. |
| Final assembly | **`pdf-lib`** for cover + TOC pages + merging + bookmarks | pdf-lib copies pages by reference, preserving original byte streams. |
| Bates numbering | `pdf-lib` page overlays — draw text on each page without modifying source content streams | Stamps in the bottom margin; deterministic per export. |
| Bookmark generation | `pdf-lib` outline API | One bookmark per Item, pointing to that item's first page in the assembled PDF. |
| Fallback for pdf-lib edge cases | **`qpdf`** invoked via `child_process` | Linearization, repair, or bookmark fixes if pdf-lib chokes on a malformed source PDF. Installed in the worker container. |

**Cover sheet + TOC rendering:** generate as a separate PDF using `pdf-lib` (drawn text, lines, optional embedded logo from the workspace). Then merge cover → TOC → source PDFs into the final export. TOC entries are clickable internal links to the bookmarked pages.

**Original-bytes invariant** (carrying from Step 4): the worker NEVER re-saves a manufacturer PDF. Bates and bookmarks live in the assembled output only.

## 6. AI

| Concern | Choice |
|---|---|
| SDK | **`@anthropic-ai/sdk`** |
| Classify model | **Claude Sonnet 4.6** with vision | Cheap, fast, vision-capable, handles doc-type classification well. |
| Extract model | **Claude Sonnet 4.6** with vision + structured output (tool use → JSON schema) | Same model for attribute extraction; output validated by Zod against the `ItemAttribute` shape. |
| Spec compliance (V1.1) | **Claude Opus 4.7** reserved | Higher accuracy for cross-document reasoning. Not built at MVP. |
| Prompt caching | **Enabled** on system prompts + few-shot exemplars | The classify prompt + ~5 labeled examples is identical across every PDF; caching them is a >50% cost cut on input tokens at any volume. |
| Vision input | Send rendered page images (PNG, max 1568px wide per Anthropic guidance) — not the raw PDF | Smaller payloads, faster, sidesteps multi-page PDF handling in the API. |
| Retries | 3 attempts with exponential backoff on 429/529; surface persistent failures as `processing_status='error'` |
| Confidence scores | Ask the model to emit a 0–1 confidence per field via tool use; store in `item_attributes.confidence` | If the model declines or omits, store `null` and treat as "review recommended." |

**Pipeline shape** (matches Step 4 § "Forward-looking notes"):

```
SourcePdf confirmed
   ↓
[parse_text] (pdfjs-dist)  ──> text-native? skip Textract
   ↓
[ocr]      (Textract, async if >5 pages, polled by worker)
   ↓
[classify] (Sonnet, vision: 1–3 sample pages → doc_type + confidence)
   ↓
[extract]  (Sonnet, vision: all pages → attributes + per-field source_page_id + confidence)
   ↓
package-level [batch_order] (no AI: group by sha-similar manufacturer/model; sort by spec_section)
   ↓
package.status = 'ready'
```

## 7. Queueing

| Concern | Choice |
|---|---|
| Library | **pg-boss** |
| Schema | pg-boss creates its own `pgboss.*` tables; isolated from app tables |
| Topics | `ocr`, `classify`, `extract`, `batch_order`, `render_export` (matches `processing_jobs.kind` from Step 4) |
| Concurrency | Per-topic concurrency limits set in worker config; e.g. `ocr: 4`, `classify: 8`, `extract: 8`, `render_export: 2` |
| Retries | pg-boss native retry with backoff; max 3 |
| Dead-letter | Failed jobs land in `pgboss.archive` after exhausting retries; surface via admin query at MVP |
| Idempotency | Each job keyed by `(kind, source_pdf_id)` — duplicate enqueues become no-ops |

**Why not BullMQ:** the Redis dependency isn't worth it at MVP scale. pg-boss saturates at ~hundreds of jobs/min; we won't see that traffic for many months. Migration path: pg-boss → BullMQ is a queue-adapter swap, not a rewrite, because all job state lives in `processing_jobs` rows our app owns.

## 8. Hosting & deployment

| Tier | Where | Notes |
|---|---|---|
| Web (Next.js) | **Vercel** Pro | Edge cache for static, Node runtime for API routes. Preview deploys per PR. |
| Worker | **Fly.io**, 1× `shared-cpu-2x` (256–512MB) in `iad` | Single machine to start; scale horizontally by adding instances — pg-boss handles distribution. |
| Postgres | **Neon** Pro, `us-east-1` | Branching for preview environments. Connection pooling enabled. |
| Object storage | **AWS S3**, `us-east-1` | One bucket per environment. |
| OCR | **AWS Textract**, `us-east-1` | Same region as S3 to skip egress. |
| LLM | **Anthropic API** (us) | Workspace key in Anthropic console; usage caps enabled. |
| DNS / CDN | **Cloudflare** | Proxied at the edge; protects against scrapers. |
| Email (transactional) | **Resend** | Signup verification, password reset. ~$20/mo. |
| Secrets | Vercel env vars (web) + Fly secrets (worker) | Mirrored manually; `.env.example` checked in. |

**Environments:** `dev` (local), `preview` (per PR on Vercel + a shared Fly worker reading Neon preview branches), `production`.

**Local dev:** Docker Compose with Postgres only. S3 and Textract hit dev/sandbox AWS resources (no LocalStack — too finicky for Textract emulation). Anthropic uses a personal API key with low spend cap.

## 9. Frontend libraries

| Concern | Choice |
|---|---|
| UI primitives | **shadcn/ui** (Radix) + **Tailwind CSS** |
| Drag-reorder | **dnd-kit** | Accessible, keyboard support, plays well with virtualization later. |
| Data fetching / polling | **TanStack Query** | Hooks for polling `GET /packages/:id/status` at 2 s; built-in retry and stale-time control. |
| Forms | **react-hook-form** + Zod resolver | Same Zod schemas the API validates with. |
| PDF preview in citation drawer | Server-rendered page image (WebP) from the worker | Avoids shipping pdf.js to the browser. |
| Icons | **Lucide** | |
| Toasts | **Sonner** | |

## 10. Testing

| Layer | Tool |
|---|---|
| Unit + integration | **Vitest** |
| HTTP mocks for components | **MSW** |
| End-to-end | **Playwright**, headed in dev, headless in CI |
| Critical-path E2E | One scripted flow: signup → create project → create package → upload 2 sample PDFs → wait for processing → edit one attribute → export → download |
| PDF assembly tests | Snapshot the assembled output's structure (page count, bookmark titles, Bates ranges) — NOT byte-level diffs |
| AI mocks in tests | Recorded fixtures of Anthropic responses; never hit the live API in CI |

## 11. Observability

| Concern | Choice |
|---|---|
| Error tracking | **Sentry** (web + worker), source maps uploaded on deploy |
| Logs | Structured JSON to stdout; Vercel and Fly capture; pipe to **Axiom** if/when search becomes important |
| Web vitals | Vercel Analytics |
| Worker health | A `/healthz` HTTP endpoint on the worker reporting pg-boss queue depth + recent error rate; pinged by Fly's checks |
| Uptime ping | A scheduled GitHub Action hitting `/healthz` and the web origin every 5 min (Better Stack later) |

Deferred until real traffic: APM, tracing, cost dashboards.

## 12. CI / CD

| Stage | Tool |
|---|---|
| CI | **GitHub Actions** — lint, typecheck, vitest, playwright, build |
| Deploy: web | Vercel's GitHub integration — auto-deploy `main` to prod; preview per PR |
| Deploy: worker | GitHub Action calls `flyctl deploy` on `main` merges |
| Migrations | `drizzle-kit migrate` runs in the worker deploy job *before* the new worker boots; web does not run migrations |

## 13. Cost estimate (rough, monthly, at "pilot" scale)

| Item | Estimate |
|---|---|
| Vercel Pro | $20 |
| Fly.io worker | $15–30 |
| Neon Pro | $19 |
| AWS S3 + transfer | <$10 |
| AWS Textract | ~$45 (100 pkgs × 30 pp × $1.50/1000) |
| Anthropic API | $50–200 (Sonnet input/output mix with prompt caching) |
| Resend, Sentry, Cloudflare | $0–30 (free tiers) |
| **Total** | **~$160–350/mo** |

Costs scale roughly linearly with package volume. Textract + Anthropic dominate at higher volume.

## 14. Risks & migration paths

| Risk | Mitigation / migration |
|---|---|
| pdf-lib chokes on a real-world malformed PDF | qpdf fallback already in the worker; if it gets common, evaluate a managed Python PDF microservice (PyMuPDF) called from the TS worker |
| pg-boss throughput ceiling | Swap to BullMQ on Upstash Redis; jobs are idempotent, so a cutover is a config change |
| Vercel API route timeout (current 60–300s depending on plan) for export rendering | Move export rendering fully into the worker (it already lives there for processing); web only enqueues |
| Textract accuracy on engineering drawings | Per-doc-type OCR strategy — fall back to a vision-LLM extraction prompt for shop-drawing pages |
| Neon cold start on serverless | Use the Neon serverless driver; if pain persists, switch to a small RDS instance |
| Anthropic rate limits at burst | Worker concurrency caps + queue backpressure; we never exceed our own per-minute budget |

## 15. Anti-decisions (explicitly NOT chosen)

- **No microservices** — single web app, single worker.
- **No GraphQL/tRPC** — REST per Step 5.
- **No Redis at MVP** — pg-boss covers queueing; no caching tier needed yet.
- **No managed auth (Clerk/Auth0)** — better-auth + Postgres is enough.
- **No Kubernetes** — Fly handles containers, Vercel handles edge.
- **No Python at MVP** — single language wins on velocity.
- **No mobile, no desktop, no plug-in** — carryover from brief §9.
- **No on-prem** — cloud SaaS only.

## 16. Verification

Before kicking off Step 8 (build):

1. **Spike the PDF pipeline.** Take 3 real submittal PDFs (one text-native cut sheet, one scanned warranty, one engineering shop drawing) and walk them through pdfjs-dist → Textract → pd-lib end-to-end in a throwaway script. If pd-lib can produce a merged PDF with one bookmark and Bates numbering on every page, the pipeline is viable.
2. **Spike Anthropic classify + extract** on the same 3 PDFs. Confirm doc_type accuracy, attribute extraction quality, and the confidence field shape. If accuracy is bad, the model choice (Sonnet vs Opus) is the dial to turn.
3. **Provision the live services** (Vercel project, Fly app, Neon DB, S3 bucket, Textract enabled, Anthropic workspace key). Smoke test: web "hello world" deployed, worker "hello world" deployed, both can reach Postgres.
4. **Lock the Step 5 API contract into Zod schemas** in `/packages/shared` before any endpoint handler is written; the schemas become the source of truth.

## What's next

Step 8 onward = build. The brief had 12 steps total; we're 7 in. The next gates are scaffolding (Step 8), the AI pipeline (Step 9), the editor (Step 10), export (Step 11), pilot (Step 12).
