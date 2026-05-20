import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { callModel, imageBlock, MODEL } from "./anthropic.js";
import { EXTRACT_SYSTEM, EXTRACT_TOOL } from "./prompts.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../out");

const Field = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source_page: z.number().int().min(1),
});

const ExtractResult = z.object({
  manufacturer: Field,
  model_number: Field,
  description: Field,
  spec_section_ref: Field,
});

const manifest = JSON.parse(await readFile(path.join(outDir, "render-manifest.json"), "utf8"));
const allUsage = [];

for (const entry of manifest) {
  console.log(`\n${entry.file} → extract (all ${entry.pages.length} pages)`);

  const userContent = [];
  for (const p of entry.pages) {
    userContent.push({ type: "text", text: `Page ${p.page} of ${entry.pages.length}:` });
    userContent.push(await imageBlock(path.join(outDir, entry.stem, `page-${String(p.page).padStart(2, "0")}.png`)));
  }
  userContent.push({ type: "text", text: "Extract the four attributes." });

  const result = await callModel({
    systemPrompt: EXTRACT_SYSTEM,
    userContent,
    tool: EXTRACT_TOOL,
    label: `extract:${entry.stem}`,
  });

  const parsed = ExtractResult.parse(result.input);
  console.log(`  manufacturer:     ${JSON.stringify(parsed.manufacturer.value)}  (c=${parsed.manufacturer.confidence}, p=${parsed.manufacturer.source_page})`);
  console.log(`  model_number:     ${JSON.stringify(parsed.model_number.value)}  (c=${parsed.model_number.confidence}, p=${parsed.model_number.source_page})`);
  console.log(`  description:      ${JSON.stringify(parsed.description.value)}  (c=${parsed.description.confidence}, p=${parsed.description.source_page})`);
  console.log(`  spec_section_ref: ${JSON.stringify(parsed.spec_section_ref.value)}  (c=${parsed.spec_section_ref.confidence}, p=${parsed.spec_section_ref.source_page})`);
  console.log(`  usage: in=${result.usage.input_tokens} out=${result.usage.output_tokens} cache_create=${result.usage.cache_creation_input_tokens ?? 0} cache_read=${result.usage.cache_read_input_tokens ?? 0}`);

  await mkdir(path.join(outDir, entry.stem), { recursive: true });
  await writeFile(
    path.join(outDir, entry.stem, "extract.json"),
    JSON.stringify({ model: MODEL, attributes: parsed, usage: result.usage }, null, 2),
  );
  allUsage.push({ file: entry.file, stage: "extract", usage: result.usage });
}

await writeFile(path.join(outDir, "extract-usage.json"), JSON.stringify(allUsage, null, 2));
console.log(`\nDone. Per-file results in out/<stem>/extract.json`);
