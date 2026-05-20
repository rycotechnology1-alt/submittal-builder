import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "../../fixtures");
const outDir = path.resolve(here, "../out");

const fixtures = [
  "01-daikin-vrv-cutsheet.pdf",
  "02-hardie-warranty.pdf",
  "03-woodwork-shopdrawings.pdf",
];

const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

const OCR_THRESHOLD = 50;
const report = [];

for (const file of fixtures) {
  const fullPath = path.join(fixturesDir, file);
  const data = new Uint8Array(await readFile(fullPath));
  const doc = await getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    pages.push({ page: i, textLength: text.length, needsOcr: text.length < OCR_THRESHOLD });
  }

  const needsOcr = pages.filter((p) => p.needsOcr).length;
  report.push({ file, numPages: doc.numPages, pagesNeedingOcr: needsOcr, pages });

  console.log(`${file}: ${doc.numPages} pages, ${needsOcr} need OCR`);
  for (const p of pages) {
    const flag = p.needsOcr ? " [OCR]" : "";
    console.log(`  p${String(p.page).padStart(3, "0")}: ${p.textLength} chars${flag}`);
  }
}

await writeFile(path.join(outDir, "parse-report.json"), JSON.stringify(report, null, 2));
console.log(`\nWrote parse report to out/parse-report.json`);
