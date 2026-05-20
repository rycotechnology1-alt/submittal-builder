import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pdf } from "pdf-to-img";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, "../../fixtures");
const outDir = path.resolve(here, "../out");

const fixtures = [
  "01-daikin-vrv-cutsheet.pdf",
  "02-hardie-warranty.pdf",
  "03-woodwork-shopdrawings.pdf",
];

// Anthropic vision guidance: PNG ≤ 1568px on the long edge.
const MAX_EDGE = 1568;

const manifest = [];

for (const file of fixtures) {
  const stem = file.replace(/\.pdf$/, "");
  const fileOutDir = path.join(outDir, stem);
  await mkdir(fileOutDir, { recursive: true });

  // pdf-to-img renders at 2x by default — that's plenty for vision; we resize down after.
  const doc = await pdf(path.join(fixturesDir, file), { scale: 2 });
  const pages = [];
  let i = 0;
  for await (const pageBuf of doc) {
    i++;
    // Resize so the long edge ≤ MAX_EDGE.
    const img = sharp(pageBuf);
    const meta = await img.metadata();
    const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    const resized = longEdge > MAX_EDGE
      ? await img.resize({ width: meta.width >= meta.height ? MAX_EDGE : undefined, height: meta.height > meta.width ? MAX_EDGE : undefined }).png().toBuffer()
      : pageBuf;

    const finalMeta = await sharp(resized).metadata();
    const outName = `page-${String(i).padStart(2, "0")}.png`;
    await writeFile(path.join(fileOutDir, outName), resized);

    pages.push({ page: i, width: finalMeta.width, height: finalMeta.height, bytes: resized.length });
    process.stdout.write(`  ${file} p${String(i).padStart(2, "0")}: ${finalMeta.width}x${finalMeta.height} (${(resized.length / 1024).toFixed(0)} KB)\n`);
  }

  manifest.push({ file, stem, pages });
  console.log(`${file}: rendered ${pages.length} pages\n`);
}

await writeFile(path.join(outDir, "render-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Wrote manifest to out/render-manifest.json`);
