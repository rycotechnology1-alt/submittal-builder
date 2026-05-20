import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, "../out/combined.pdf");

const bytes = await readFile(outPath);
const doc = await PDFDocument.load(bytes);
console.log("Loaded combined.pdf successfully");
console.log("  page count:", doc.getPageCount());

const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
console.log("  has Outlines entry:", !!outlinesRef);

if (outlinesRef) {
  const outlines = doc.context.lookup(outlinesRef, PDFDict);
  const count = outlines.get(PDFName.of("Count"));
  console.log("  outline count:", count?.toString() ?? "<missing>");

  // Walk the linked list
  let cur = outlines.get(PDFName.of("First"));
  let i = 0;
  while (cur) {
    const node = doc.context.lookup(cur, PDFDict);
    const title = node.get(PDFName.of("Title"));
    console.log(`  bookmark ${++i}:`, title?.toString().replace(/^\(|\)$/g, ""));
    cur = node.get(PDFName.of("Next"));
  }
}

// Check Bates stamp by scanning the content stream of page 1 for the prefix
const firstPage = doc.getPage(0);
const contents = firstPage.node.Contents();
const stream = doc.context.lookup(contents);
const streamBytes = stream?.contents ?? new Uint8Array();
const text = new TextDecoder("latin1").decode(streamBytes);
console.log("  page 1 contains 'SUB-000001':", text.includes("SUB-000001"));
