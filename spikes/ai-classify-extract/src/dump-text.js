import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "../../fixtures");
const outDir = path.resolve(here, "../out");

const fixtures = ["01-daikin-vrv-cutsheet.pdf", "02-hardie-warranty.pdf"];
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");

for (const file of fixtures) {
  const stem = file.replace(/\.pdf$/, "");
  const data = new Uint8Array(await readFile(path.join(fixturesDir, file)));
  const doc = await getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;

  let allText = `=== ${file} ===\n\n`;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" ");
    allText += `--- page ${i} ---\n${text}\n\n`;
  }
  await writeFile(path.join(outDir, `${stem}-text.txt`), allText);
  console.log(`Wrote ${stem}-text.txt`);
}
