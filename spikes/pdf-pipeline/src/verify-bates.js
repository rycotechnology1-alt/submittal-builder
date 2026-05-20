import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, "../out/combined.pdf");
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

const data = new Uint8Array(await readFile(outPath));
const doc = await getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;

const checks = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
  const expected = `SUB-${String(i).padStart(6, "0")}`;
  const found = text.includes(expected);
  checks.push({ page: i, expected, found });
}

const missing = checks.filter((c) => !c.found);
console.log(`Bates check: ${checks.length - missing.length}/${checks.length} pages stamped correctly`);
if (missing.length) {
  console.log("Missing on pages:", missing.map((m) => m.page).join(", "));
} else {
  console.log("All pages have correct Bates stamp.");
}
