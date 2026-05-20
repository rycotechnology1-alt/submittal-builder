import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { callModel, imageBlock, MODEL } from "./anthropic.js";
import { CLASSIFY_SYSTEM, CLASSIFY_TOOL } from "./prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../out");

const ClassifyResult = z.object({
  doc_type: z.enum(["cut_sheet", "warranty", "shop_drawing", "other"]),
  doc_type_confidence: z.number().min(0).max(1),
});

const manifest = JSON.parse(await readFile(path.join(outDir, "render-manifest.json"), "utf8"));

function samplePageIndices(numPages) {
  if (numPages <= 3) return Array.from({ length: numPages }, (_, i) => i + 1);
  return [1, Math.ceil(numPages / 2), numPages];
}

const allUsage = [];

for (const entry of manifest) {
  const sampled = samplePageIndices(entry.pages.length);
  console.log(`\n${entry.file} → classify (pages ${sampled.join(", ")})`);

  const userContent = [];
  for (const p of sampled) {
    userContent.push({ type: "text", text: `Page ${p} of ${entry.pages.length}:` });
    userContent.push(await imageBlock(path.join(outDir, entry.stem, `page-${String(p).padStart(2, "0")}.png`)));
  }
  userContent.push({ type: "text", text: "Classify this document." });

  const result = await callModel({
    systemPrompt: CLASSIFY_SYSTEM,
    userContent,
    tool: CLASSIFY_TOOL,
    label: `classify:${entry.stem}`,
  });

  const parsed = ClassifyResult.parse(result.input);
  console.log(`  → ${parsed.doc_type} (confidence ${parsed.doc_type_confidence})`);
  console.log(`  usage: in=${result.usage.input_tokens} out=${result.usage.output_tokens} cache_create=${result.usage.cache_creation_input_tokens ?? 0} cache_read=${result.usage.cache_read_input_tokens ?? 0}`);

  await mkdir(path.join(outDir, entry.stem), { recursive: true });
  await writeFile(
    path.join(outDir, entry.stem, "classify.json"),
    JSON.stringify({ model: MODEL, ...parsed, sampled_pages: sampled, usage: result.usage }, null, 2),
  );
  allUsage.push({ file: entry.file, stage: "classify", usage: result.usage });
}

await writeFile(path.join(outDir, "classify-usage.json"), JSON.stringify(allUsage, null, 2));
console.log(`\nDone. Per-file results in out/<stem>/classify.json`);
