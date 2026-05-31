# pdf-pipeline spike — snapshot

Run date: 2026-05-20
Node: v24.14.1
Libs: pdfjs-dist 5.7.284, pdf-lib 1.17.1

## Inputs

| # | File | Pages | Pages needing OCR (<50 chars) |
|---|---|---|---|
| 1 | `fixtures/01-daikin-vrv-cutsheet.pdf` | 3 | 0 |
| 2 | `fixtures/02-hardie-warranty.pdf` | 2 | 0 |
| 3 | `fixtures/03-woodwork-shopdrawings.pdf` | 26 | 22 |

The shop-drawing PDF is mostly raster content (pages 3 and 5–8 and 10–26 each return ~6 chars of extractable text). This is exactly the case Textract is meant to handle in Phase 4. OCR was **not** exercised in this spike because the spike only proves the assembly path; OCR has its own deliverable in the worker pipeline phase.

## Output

`out/combined.pdf`

| Metric | Value |
|---|---|
| Page count | 33 (1 cover + 1 TOC + 3 + 2 + 26) |
| Byte size | 3,050 KB |
| Bates range | `SUB-000001` to `SUB-000033` |
| Bates verification | 33/33 pages stamped correctly (verified via pdfjs-dist text extraction) |
| Outline entries | 3 (one per source PDF) |
| PageMode | `/UseOutlines` (Acrobat opens with bookmarks pane visible) |

## Bookmarks

| Target page | Title |
|---|---|
| p.3 | Daikin VRV Outdoor Unit — Submittal |
| p.6 | James Hardie Lap Siding — 30-Year Warranty |
| p.8 | Woodwork Institute — Sample Shop Drawings |

## qpdf fallback decision

**Not needed.** pdf-lib loaded and `copyPages`-ed all three source PDFs without error, including the 26-page Woodwork shop drawing which was the riskiest candidate per [step-7-stack-lockin.md §14](../../step-7-stack-lockin.md). Phase 4/5 should still install `qpdf` in the worker container per the plan, but on this fixture set the fallback was never triggered.

## Confirmed invariants (from [step-7 §5](../../step-7-stack-lockin.md))

- **Original-bytes preservation:** sources were merged via `pdf-lib`'s `copyPages` (page-by-reference). The manufacturer content streams were not re-encoded; Bates numbers and bookmarks live only in newly-added overlays/outline objects.
- **Bates placement:** drawn at bottom-center (`y=18`) in 9pt Helvetica grey, outside typical content margins.
- **Bookmark navigation:** uses `/XYZ` destinations targeting each source PDF's first page in the assembled output.

## How to reproduce

```
cd spikes/pdf-pipeline
npm install
node src/parse.js          # page-level text-length report
node src/assemble.js       # build out/combined.pdf
node src/verify.js         # structural check (page count, outlines)
node src/verify-bates.js   # Bates stamp check via text extraction
```

## Manual-verification checklist (open `out/combined.pdf` in Acrobat)

- [ ] File opens without error dialogs
- [ ] Bookmarks pane shows the three entries above
- [ ] Clicking each bookmark jumps to the right page
- [ ] Bates number visible at bottom-center of every page
- [ ] Source PDF pages render identically to the originals (no re-encoding artifacts)
