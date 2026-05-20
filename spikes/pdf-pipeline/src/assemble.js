import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, PDFName, PDFArray, PDFNumber, PDFString, PDFRef } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "../../fixtures");
const outDir = path.resolve(here, "../out");

const sources = [
  { file: "01-daikin-vrv-cutsheet.pdf",   title: "Daikin VRV Outdoor Unit — Submittal" },
  { file: "02-hardie-warranty.pdf",       title: "James Hardie Lap Siding — 30-Year Warranty" },
  { file: "03-woodwork-shopdrawings.pdf", title: "Woodwork Institute — Sample Shop Drawings" },
];

const PAGE_W = 612;   // US Letter, points
const PAGE_H = 792;
const BATES_PREFIX = "SUB-";
const BATES_DIGITS = 6;

const out = await PDFDocument.create();
const font = await out.embedFont(StandardFonts.Helvetica);
const fontBold = await out.embedFont(StandardFonts.HelveticaBold);

// --- Cover page ---
const cover = out.addPage([PAGE_W, PAGE_H]);
cover.drawText("SUBMITTAL PACKAGE", { x: 72, y: PAGE_H - 144, size: 28, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
cover.drawText("Phase 0 Spike — pdf-pipeline", { x: 72, y: PAGE_H - 180, size: 14, font, color: rgb(0.3, 0.3, 0.3) });
cover.drawText("Workspace:  [placeholder]",  { x: 72, y: PAGE_H - 260, size: 12, font });
cover.drawText("Project:    [placeholder]",  { x: 72, y: PAGE_H - 282, size: 12, font });
cover.drawText("Package:    [placeholder]",  { x: 72, y: PAGE_H - 304, size: 12, font });
cover.drawText(`Generated:  ${new Date().toISOString().slice(0, 10)}`, { x: 72, y: PAGE_H - 326, size: 12, font });
cover.drawLine({ start: { x: 72, y: PAGE_H - 350 }, end: { x: PAGE_W - 72, y: PAGE_H - 350 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
cover.drawText("Contents", { x: 72, y: PAGE_H - 380, size: 16, font: fontBold });
for (let i = 0; i < sources.length; i++) {
  cover.drawText(`${i + 1}.  ${sources[i].title}`, { x: 90, y: PAGE_H - 410 - i * 22, size: 11, font });
}

// --- Merge sources, capture per-source first-page indices in the output ---
const sectionStarts = []; // { title, pageIndex }
for (const src of sources) {
  const bytes = await readFile(path.join(fixturesDir, src.file));
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageIndices = srcDoc.getPageIndices();
  const copied = await out.copyPages(srcDoc, pageIndices);
  sectionStarts.push({ title: src.title, pageIndex: out.getPageCount() }); // index in `out` BEFORE adding
  for (const p of copied) out.addPage(p);
}

// --- Build a TOC page (now that we know starting page numbers) and insert at index 1 ---
const toc = out.insertPage(1, [PAGE_W, PAGE_H]);
toc.drawText("Table of Contents", { x: 72, y: PAGE_H - 96, size: 20, font: fontBold });
toc.drawLine({ start: { x: 72, y: PAGE_H - 108 }, end: { x: PAGE_W - 72, y: PAGE_H - 108 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
// Note: inserting the TOC at index 1 shifts every section's pageIndex up by 1.
const shifted = sectionStarts.map((s) => ({ title: s.title, pageNumber: s.pageIndex + 1 + 1 })); // +1 for shift, +1 for 1-based numbering
let y = PAGE_H - 144;
for (let i = 0; i < shifted.length; i++) {
  const s = shifted[i];
  toc.drawText(`${i + 1}.  ${s.title}`,     { x: 72, y, size: 11, font });
  toc.drawText(`p. ${s.pageNumber}`,        { x: PAGE_W - 120, y, size: 11, font });
  y -= 22;
}

// --- Bates stamp on every page ---
const totalPages = out.getPageCount();
for (let i = 0; i < totalPages; i++) {
  const page = out.getPage(i);
  const label = `${BATES_PREFIX}${String(i + 1).padStart(BATES_DIGITS, "0")}`;
  const { width } = page.getSize();
  const labelWidth = font.widthOfTextAtSize(label, 9);
  page.drawText(label, {
    x: (width - labelWidth) / 2,
    y: 18,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
}

// --- Outline (bookmarks) — one entry per source PDF ---
// pdf-lib has no high-level outline API; build it via the context.
const context = out.context;
const outlineRefs = shifted.map(() => context.nextRef());
const outlinesDictRef = context.nextRef();

shifted.forEach((s, i) => {
  const pageRef = out.getPage(s.pageNumber - 1).ref;
  const dest = PDFArray.withContext(context);
  dest.push(pageRef);
  dest.push(PDFName.of("XYZ"));
  dest.push(PDFNumber.of(0));
  dest.push(PDFNumber.of(PAGE_H));
  dest.push(PDFNumber.of(0));

  const dict = context.obj({
    Title: PDFString.of(s.title),
    Parent: outlinesDictRef,
    Dest: dest,
  });
  if (i > 0) dict.set(PDFName.of("Prev"), outlineRefs[i - 1]);
  if (i < shifted.length - 1) dict.set(PDFName.of("Next"), outlineRefs[i + 1]);
  context.assign(outlineRefs[i], dict);
});

const outlinesDict = context.obj({
  Type: PDFName.of("Outlines"),
  First: outlineRefs[0],
  Last: outlineRefs[outlineRefs.length - 1],
  Count: PDFNumber.of(shifted.length),
});
context.assign(outlinesDictRef, outlinesDict);
out.catalog.set(PDFName.of("Outlines"), outlinesDictRef);
out.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

const bytes = await out.save();
const outPath = path.join(outDir, "combined.pdf");
await writeFile(outPath, bytes);

// --- Snapshot summary ---
const snapshot = {
  outputPath: outPath,
  totalPages,
  byteSize: bytes.length,
  batesRange: `${BATES_PREFIX}${"0".repeat(BATES_DIGITS - 1)}1 to ${BATES_PREFIX}${String(totalPages).padStart(BATES_DIGITS, "0")}`,
  bookmarks: shifted,
};
await writeFile(path.join(outDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));

console.log(`Wrote ${outPath}`);
console.log(`  ${totalPages} pages, ${(bytes.length / 1024).toFixed(0)} KB`);
console.log(`  Bates: ${snapshot.batesRange}`);
console.log(`  Bookmarks:`);
for (const b of shifted) console.log(`    p.${b.pageNumber}  ${b.title}`);
