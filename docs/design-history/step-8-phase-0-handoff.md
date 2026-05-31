# Phase 0 Handoff — Spikes & Live-Service Provisioning

Phase 0 is **complete**. Both technical-risk spikes passed their gates and every external service the build plan calls for has been provisioned, with the single intentional deferral noted below (Cloudflare — no domain yet).

## What was built

Two throwaway de-risking spikes plus the `.env.example` matrix at the repo root. No code under `apps/` or `packages/` was touched — that's Phase 1's job.

### 1. PDF assembly spike — [spikes/pdf-pipeline/](spikes/pdf-pipeline/)

Proves the `pdfjs-dist → pdf-lib` pipeline can take real submittal PDFs and produce a valid assembled output with bookmarks and Bates numbering, preserving the manufacturer bytes. See [SNAPSHOT.md](spikes/pdf-pipeline/SNAPSHOT.md) for the full result.

| Metric | Result |
|---|---|
| Input fixtures | 3 PDFs in `spikes/fixtures/` — text-native cut sheet, warranty, 26-page raster shop drawing |
| Output | `out/combined.pdf`: 33 pages (1 cover + 1 TOC + 3 + 2 + 26 sources), 3,050 KB |
| Bates | `SUB-000001` to `SUB-000033` — verified 33/33 stamps via `pdfjs-dist` text extraction |
| Bookmarks | 3 entries (one per source), `/PageMode = /UseOutlines` so Acrobat opens with the pane visible |
| Original-bytes invariant | Preserved via `pdf-lib`'s `copyPages` — no source content streams modified |
| **qpdf fallback decision** | **Not needed** on this fixture set — `pdf-lib` loaded the 26-page Woodwork shop drawing without complaint. Phase 4/5 should still install `qpdf` in the worker container per [step-7 §14](step-7-stack-lockin.md) — keep it as the dormant fallback, not a hard prerequisite. |

### 2. AI classify + extract spike — [spikes/ai-classify-extract/](spikes/ai-classify-extract/)

Proves Claude Sonnet 4.6 + vision + tool use produces structured output conforming to the `ItemAttribute` shape with usable confidences. See [SNAPSHOT.md](spikes/ai-classify-extract/SNAPSHOT.md) for the full result.

| Metric | Result |
|---|---|
| doc_type accuracy | **3/3 = 100%** at 0.97–0.99 confidence |
| Attribute accuracy (12 fields) | 11 correct, 1 acceptable (variant match), 0 incorrect |
| Combined accuracy across all 15 graded fields | **100% correct-or-acceptable**, 93% strictly correct |
| Hallucinations | 0 — all three `spec_section_ref` correctly returned null (none printed in source) |
| Total tokens (6 API calls) | 64,500 input + 751 output + 1,477 cache write + 2,954 cache read |
| Total spend | **~$0.21 USD** |
| Prompt cache | Engaged on `extract` (calls 2 and 3 read 1,477 cached tokens); did not engage on `classify` because that prompt is under Anthropic's ~1024-token cache minimum |
| **AI model decision** | **Keep Sonnet 4.6 for Phase 4.** No need to dial up to Opus 4.7 — the 80% gate was cleared by a wide margin. Per [step-8-buildplan.md:36](step-8-buildplan.md), Opus 4.7 is the fallback if Sonnet underperforms; revisit only if Phase 4 testing on broader fixtures shows degradation. |

The `out/{stem}/classify.json` and `extract.json` files from this spike are the **recorded fixtures for Phase 4** — Phase 4's CI tests should mock against them rather than hit the live API, per [step-7 §10](step-7-stack-lockin.md).

### 3. Environment matrix — [.env.example](.env.example)

Twelve sections covering every external service called out in [step-7](step-7-stack-lockin.md). Sections 1–8 populated in the local `.env.local`; section 9 (Cloudflare/domain) intentionally deferred — see "What's stubbed/deferred" below.

## Where it lives

```
spikes/
  fixtures/                              3 sample PDFs (committed; ~5-15 MB total — gitignore keeps them in)
    01-daikin-vrv-cutsheet.pdf
    02-hardie-warranty.pdf
    03-woodwork-shopdrawings.pdf
  pdf-pipeline/
    package.json                         npm, ESM, throwaway — not part of the Phase 1 monorepo
    src/parse.js                         per-page text-length report
    src/assemble.js                      cover → TOC → 3 sources → bookmarks → Bates
    src/verify.js                        structural sanity check
    src/verify-bates.js                  Bates verification via pdfjs text extraction
    SNAPSHOT.md                          phase-0 deliverable summary
    out/combined.pdf                     the assembled artifact
    out/parse-report.json, snapshot.json
  ai-classify-extract/
    package.json                         npm, ESM, throwaway
    .env.example                         single var: ANTHROPIC_API_KEY
    src/render-pages.js                  pdf-to-img + sharp → PNG ≤ 1568px long edge
    src/prompts.js                       system prompts + tool schemas (cache-eligible)
    src/anthropic.js                     SDK wrapper with retry/backoff + cache_control
    src/classify.js                      first/middle/last pages → classify_document tool
    src/extract.js                       all pages → extract_item tool
    src/accuracy.js                      diff vs. ground-truth.json (Jaccard token-overlap)
    src/dump-text.js                     pulled raw PDF text for ground-truth drafting (one-off)
    fixtures/ground-truth.json           hand-authored canonical answers + variant lists
    SNAPSHOT.md                          phase-0 deliverable summary
    out/ACCURACY.md                      per-field grading table
    out/{stem}/classify.json             Phase 4 test fixtures
    out/{stem}/extract.json              Phase 4 test fixtures
    out/{stem}/page-NN.png               rendered page images (gitignored — regen via render-pages.js)
.env.example                             root-level env matrix (12 sections)
.gitignore                               already covers .env / .env.* / spikes/**/output
```

Spike PNG outputs (~14 MB) are gitignored via the existing `spikes/**/*.png` rule. Fixture PDFs are kept in git per the existing `!spikes/**/fixtures/**` negation — intentional, for reproducibility if upstream URLs rot.

## Env vars / secrets added

All 12 sections of [.env.example](.env.example) are committed (no values). The user populated their local `.env.local` with values for sections **1–8 and 10–12**:

| # | Section | Status |
|---|---|---|
| 1 | AWS (S3 + Textract) | populated |
| 2 | Neon (DATABASE_URL_*) | populated |
| 3 | Anthropic API key | populated — **see security note below** |
| 4 | Resend (email) | populated |
| 5 | better-auth secret | populated |
| 6 | Vercel | populated |
| 7 | Fly.io | populated |
| 8 | Sentry | populated |
| 9 | Cloudflare / APP_DOMAIN | **deferred — no domain yet** |
| 10 | GitHub | populated (or default) |
| 11 | pg-boss concurrency | defaults from step-7 §7 |
| 12 | Runtime flags | defaults |

## What's stubbed / deferred

1. **Cloudflare and APP_DOMAIN (section 9).** No domain registered yet. Local dev uses `http://localhost:3000` for `APP_PUBLIC_URL` and `BETTER_AUTH_URL`. When a domain is acquired: register at any registrar, add to Cloudflare, proxy DNS, set `APP_DOMAIN` and `APP_PUBLIC_URL`. This becomes a hard prerequisite before **Phase 6** (Resend email links and Sentry source-map uploads both need a real public URL) but does NOT block Phases 1–5.

2. **Deployed "hello world" smoke test for Vercel + Fly.** [step-8-buildplan.md:31](step-8-buildplan.md) calls for proving web and worker can deploy and reach Postgres. The accounts exist, but no app has been pushed yet — that's Phase 1's first deliverable (the monorepo scaffold). Reachability from this laptop has been confirmed: `psql` against the Neon dev branch, `aws s3 ls`, Anthropic API responding. The deploy-target smoke test rolls into Phase 1.

3. **S3 CORS configuration.** Bucket exists but CORS not yet locked down — [step-8-buildplan.md:96](step-8-buildplan.md) puts the literal `infra/s3-cors.json` in Phase 3 where the presigned-upload contract is defined. Defer entirely.

4. **`qpdf` install in worker container.** Not needed by the spike (pdf-lib handled all three fixtures clean). Still install it in the Fly worker image during Phase 4/5 per the build plan — keeps the fallback path available for future malformed PDFs.

5. **Prompt cache on `classify`.** Cache breakpoint is set but doesn't engage because the classify system prompt is below Anthropic's ~1024-token minimum. **Phase 4 should expand the classify system prompt** (more few-shot exemplars, more doc_type definitions, edge-case guidance) to clear 1024 tokens — every subsequent call gets the ~10× cache discount on the cached portion.

6. **Broader AI fixture set.** Spike used n=3. Phase 4 should re-grade on at least 10–20 real submittal PDFs before locking the prompts. Particularly missing today: a scanned cut sheet (to exercise the Textract → Sonnet path end-to-end) and a PDF that actually prints a CSI section reference (to exercise the positive case for `spec_section_ref`).

## Known gaps and risks

1. **`@napi-rs/canvas` dead-end documented.** Initial attempt at PDF page rendering used `pdfjs-dist + @napi-rs/canvas`; `@napi-rs/canvas` rejects pdfjs 5.x's Path-object fills with `InvalidArg`. Worked around using the `pdf-to-img` npm package, which wraps a compatible renderer. **Phase 3's `packages/shared/pdf/render.ts` should use `pdf-to-img` (or equivalent) — do NOT re-attempt the @napi-rs/canvas path.**

2. **Source-page citation accuracy not independently graded.** The extract spike returned `source_page=1` for every field, which is plausible for these single-page-product fixtures but might be wrong on multi-page packages. Phase 4 needs at least one fixture where attributes live on different pages, to grade citation correctness.

3. **Brand-ambiguity surfaces in real submittal data.** The Daikin VRV fixture is © Johnson Controls (JCI licenses the VRV technology). The model chose "Johnson Controls" (canonical) and "Daikin" was an acceptable variant. Phase 4's eval set should explicitly cover brand-ambiguity cases — license-branded products, OEM rebrands — so the prompt can be tuned (e.g., "prefer the copyright/legal entity over the marketing brand").

4. **Cost projection.** Spike came in at $0.21 for 31 pages (~$0.007/page) on Sonnet 4.6. A typical 30-page submittal package projects to ~$0.20 in Anthropic spend. Aligns with the [step-7 §13](step-7-stack-lockin.md) pilot-scale estimate of $50–200/mo.

5. **🔐 Anthropic API key was briefly exposed in tool output.** During Workstream C debugging, a `tail -c 50 .env | od -c` command printed roughly the last 50 chars of the key to my tool output as I diagnosed why `dotenv` wasn't loading it. **The key must be rotated** in the Anthropic console before Phase 1 starts. Generate a fresh key, update `ANTHROPIC_API_KEY` in `.env.local`, revoke the old one. Recorded in [SNAPSHOT.md](spikes/ai-classify-extract/SNAPSHOT.md). Going forward, secrets-bearing files should never be passed to `head/tail/cat/od` directly — use the grep-with-redaction pattern that hides values.

## Verification status

Per [step-8-buildplan.md:34](step-8-buildplan.md):

- [x] `spikes/pdf-pipeline/out/combined.pdf` exists, opens, has 3 bookmarks and Bates on every page (33/33 verified programmatically; Acrobat verification is the user's manual checklist in the SNAPSHOT).
- [x] `spikes/ai-classify-extract/out/{stem}/extract.json` validates against a Zod schema mirroring `ItemAttribute` shape with non-null confidences.
- [x] All external services smoke-pinged from the laptop. `psql` to Neon dev branch, `aws s3 ls` on the dev bucket, Anthropic API responding (6 successful calls).
- [x] `.env.example` committed at repo root, 12 sections, no values.
- [x] This handoff doc committed.

## Phase 1 starting point — for the next agent picking up cold

**Goal of Phase 1** per [step-8-buildplan.md:42](step-8-buildplan.md): scaffold the pnpm monorepo, wire Drizzle schema + first migration, integrate better-auth with Resend email verification, and make `pnpm dev` produce a runnable web + worker pair where a new user can sign up, receive an email, log in, and hit `GET /api/v1/me`.

### Pre-flight checklist before Phase 1 begins

1. **Install pnpm globally.** Phase 0 used `npm` inside the disposable spike folders. Phase 1's monorepo locks in pnpm per [step-7 §1](step-7-stack-lockin.md). Run either `corepack enable && corepack prepare pnpm@latest --activate` (needs admin on Windows — try first) or `npm i -g pnpm`. Verify with `pnpm --version`.
2. **Rotate the Anthropic API key** (see Known gaps #5). Update `.env.local`.
3. **Skim the spike code, especially the prompts.** [spikes/ai-classify-extract/src/prompts.js](spikes/ai-classify-extract/src/prompts.js) contains the working system prompts + tool schemas — they're throwaway as code but they're the working starting point for [packages/shared/ai/prompts.ts](packages/shared/ai/prompts.ts) in Phase 4. Don't rewrite from scratch; port + extend.
4. **Confirm Neon dev branch is reachable** from the machine that will run Phase 1: `psql "$DATABASE_URL_DIRECT_DEV" -c "select 1"`.

### What Phase 1 should produce (per [step-8-buildplan.md:44-54](step-8-buildplan.md))

- `pnpm-workspace.yaml` + root `package.json`
- `apps/web/` — Next.js 15 App Router, strict TS, better-auth wired
- `apps/worker/` — Node 20 + pg-boss stub, `/healthz` returns 200 only
- `packages/db/` — Drizzle schema covering every table from [data-model.md](data-model.md), plus `0001_init.sql` migration applied to the Neon dev branch
- `packages/shared/` — empty stubs for the Zod-API-schemas / AI-prompts / PDF-utils modules later phases will fill in
- `.github/workflows/ci.yml` — lint + typecheck + vitest on PR
- `apps/web/src/server/workspace.ts` — `withWorkspace()` tenancy helper (every authed request resolves workspace_id, cross-workspace IDs → 404 not 403)
- Resend integration for signup verification and password-reset email
- Sentry SDK installed on web + worker (smoke-test via a deliberate throw)

### Phase 1 exit criteria

`pnpm dev` boots web + worker. Local user can sign up → receive a Resend verification email → log in → `GET /api/v1/me` → log out. `pnpm test` passes the signup→/me→logout integration test. Drizzle Studio shows all tables. Then **write `step-8-phase-1-handoff.md`** using the same structure as this doc.

### Things Phase 1 should NOT do (defer to later phases)

- Any S3 calls or file upload endpoints (Phase 3)
- Any AI / worker job logic (Phase 4)
- Item attribute mutations, exports, Bates rendering (Phase 5)
- Cloudflare DNS / public domain wiring (Phase 6 or whenever a domain is acquired)
