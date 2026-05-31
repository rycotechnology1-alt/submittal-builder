# ai-classify-extract spike — snapshot

Run date: 2026-05-20
Model: `claude-sonnet-4-6`
SDK: `@anthropic-ai/sdk`
Inputs: 3 fixtures from `spikes/fixtures/` (same set as the pdf-pipeline spike).

## Headline result

**Phase 0 gate passed.** The brief requires doc_type accuracy ≥80% on the 3-PDF set. Result: **3/3 = 100%**, at 0.97–0.99 confidence.

| Metric | Value |
|---|---|
| doc_type accuracy | 3/3 (100%) |
| Attribute accuracy (12 fields) | 11 correct, 1 acceptable, 0 incorrect |
| Combined accuracy across all 15 fields | 14 correct + 1 acceptable = **100% correct-or-acceptable**, 93% strictly correct |
| Hallucinations | 0 (no fabricated `spec_section_ref` values — model correctly returned null on all 3) |
| Total tokens (6 API calls) | 64,500 input + 751 output + 1,477 cache write + 2,954 cache read |
| **Total cost** | **~$0.21 USD** |

See `out/ACCURACY.md` for the per-field grading table.

## AI model decision for Phase 4

**Keep Sonnet 4.6.** No need to dial up to Opus 4.7 — accuracy on this fixture set well exceeds the 80% gate. Per [step-8-buildplan.md:36](../../step-8-buildplan.md), Opus 4.7 is the fallback if Sonnet underperforms; it does not. Revisit only if Phase 4 testing on broader fixtures shows degradation.

## Prompt-cache evidence

`cache_control: { type: "ephemeral" }` was set on the system-prompt content block for every call.

- **Classify (3 calls):** cache did NOT engage. `cache_creation_input_tokens=0` across all calls because the CLASSIFY_SYSTEM prompt is under Anthropic's ~1024-token cache minimum (roughly 250 tokens after few-shots).
- **Extract (3 calls):** cache engaged. Call 1 (Daikin) wrote 1,477 tokens to cache. Calls 2 (Hardie) and 3 (Woodwork) each read 1,477 tokens from cache — `cache_read_input_tokens=1477, cache_creation_input_tokens=0`.

Implication for Phase 4: the production prompt needs to be ≥1024 tokens to enable caching. The extract prompt clears that bar today; the classify prompt does not. At the volume Phase 4 will process, expanding the classify prompt with more few-shot exemplars (to clear 1024 tokens) is worth the small initial cost — every subsequent call gets the 10× discount on the cached portion.

## Per-PDF result fixtures

These are committed JSON files that Phase 4 tests will mock against, eliminating live-API spend in CI per [step-7 §10](../../step-7-stack-lockin.md).

| File | classify.json | extract.json |
|---|---|---|
| 01-daikin-vrv-cutsheet | `out/01-daikin-vrv-cutsheet/classify.json` | `out/01-daikin-vrv-cutsheet/extract.json` |
| 02-hardie-warranty | `out/02-hardie-warranty/classify.json` | `out/02-hardie-warranty/extract.json` |
| 03-woodwork-shopdrawings | `out/03-woodwork-shopdrawings/classify.json` | `out/03-woodwork-shopdrawings/extract.json` |

## ItemAttribute shape compliance

Each `extract.json` validates against a Zod schema mirroring the `item_attributes` row shape from [data-model.md:115](data-model.md):

```js
{ value: string | null, confidence: number (0..1), source_page: integer >= 1 }
```

In Phase 4, `source_page` (the 1-based page number used here) becomes `source_page_id` (a UUID FK to `source_pages.id`). The translation is mechanical — Phase 4's worker has both the source_pdf_id and the page indices in hand, so the lookup is local.

## What was rendered

All 31 PDF pages rendered to PNG via `pdf-to-img` (npm), resized via `sharp` so the long edge ≤ 1568px per Anthropic vision guidance ([step-7 §6](../../step-7-stack-lockin.md)). Manifest at `out/render-manifest.json`.

`pdf-to-img` was chosen over `pdfjs-dist + @napi-rs/canvas` because @napi-rs/canvas rejects pdfjs 5.x's Path-object fills — recorded so Phase 4 doesn't repeat the dead-end. For Phase 4 the production renderer in `packages/shared/pdf/render.ts` should also use `pdf-to-img` (or equivalent) rather than rolling its own canvas factory.

## Known limitations / things Phase 4 should re-verify

1. **Fixture set is small (n=3).** Results here are necessary but not sufficient. Phase 4 should run the same prompts against a broader fixture set — at least 10–20 real submittal PDFs — before locking the prompt. Especially needed: an OCR-only document (scanned cut sheet) to confirm Textract-then-Sonnet path doesn't lose accuracy.
2. **Source-page citations weren't independently graded.** The model returned source_page=1 for everything (which is plausible for these single-product files but might be wrong on multi-product packages). Phase 4 should grade source_page accuracy on packages where attributes actually live on different pages.
3. **`spec_section_ref` is null everywhere.** This fixture set doesn't exercise the positive case — the model never had to recognize a CSI section number. Phase 4 needs a fixture that includes a printed CSI section to confirm the prompt-instructed behavior ("only return a value if you literally see it printed") works in practice.
4. **Cost projection.** At $0.21 for 3 PDFs (31 pages total), the per-page cost is ~$0.007. A typical submittal package of 30 pages = ~$0.20 in API cost. Compatible with the [step-7 §13](../../step-7-stack-lockin.md) cost estimate (~$50-200/mo Anthropic at pilot scale).

## How to reproduce

```
cd spikes/ai-classify-extract
npm install
cp .env.example .env             # then paste ANTHROPIC_API_KEY
node src/render-pages.js          # local, no API cost
node src/classify.js              # 3 API calls
node src/extract.js               # 3 API calls
node src/accuracy.js              # local diff vs. fixtures/ground-truth.json
```

## Operational note (security)

During execution, a diagnostic command piped the tail of `.env` to stdout, briefly exposing part of the API key value in tool output. The key should be **rotated in the Anthropic console** before this spike is treated as complete. Future spike work should avoid `head/tail/od` on the `.env` file.
