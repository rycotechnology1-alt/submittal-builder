import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../out");
const fixturesDir = path.resolve(here, "../fixtures");

const truth = JSON.parse(await readFile(path.join(fixturesDir, "ground-truth.json"), "utf8"));

function gradeStr(actual, canonical, variants = []) {
  if (canonical === null && actual === null) return { grade: "correct", note: "both null (correct)" };
  if (canonical === null && actual !== null) {
    const variantMatch = variants.some((v) => normalize(actual).includes(normalize(v)) || normalize(v).includes(normalize(actual)));
    return variantMatch
      ? { grade: "acceptable", note: `expected null but got "${actual}" — matches an acceptable variant` }
      : { grade: "incorrect", note: `expected null but got "${actual}"` };
  }
  if (canonical !== null && actual === null) return { grade: "incorrect", note: `expected "${canonical}" but got null` };

  const a = normalize(actual);
  const c = normalize(canonical);
  if (a === c || a.includes(c) || c.includes(a)) return { grade: "correct", note: `matched canonical "${canonical}"` };

  const jc = jaccard(tokens(a), tokens(c));
  if (jc >= 0.5) return { grade: "correct", note: `token overlap ${(jc * 100).toFixed(0)}% with canonical` };

  for (const v of variants) {
    const nv = normalize(v);
    if (a === nv || a.includes(nv) || nv.includes(a)) return { grade: "acceptable", note: `matched variant "${v}"` };
    if (jaccard(tokens(a), tokens(nv)) >= 0.5) return { grade: "acceptable", note: `token overlap with variant "${v}"` };
  }
  return { grade: "incorrect", note: `expected "${canonical}", got "${actual}"` };
}

function normalize(s) {
  return String(s).toLowerCase().replace(/[\s,.\-()®™—]+/g, " ").trim();
}

const STOPWORDS = new Set(["a","an","the","for","of","and","or","to","in","on","with","by","as","at"]);
function tokens(s) {
  return new Set(s.split(/\s+/).filter((t) => t && !STOPWORDS.has(t)));
}
function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

const lines = [];
lines.push("# Workstream C — Accuracy report");
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");
lines.push("Grades: **correct** (matches canonical), **acceptable** (matches a listed variant), **incorrect**.");
lines.push("");

const stats = { correct: 0, acceptable: 0, incorrect: 0 };

for (const fx of truth.fixtures) {
  const stem = fx.file.replace(/\.pdf$/, "");
  const classifyPath = path.join(outDir, stem, "classify.json");
  const extractPath = path.join(outDir, stem, "extract.json");

  const classify = JSON.parse(await readFile(classifyPath, "utf8"));
  const extract = JSON.parse(await readFile(extractPath, "utf8"));

  lines.push(`## ${fx.file}`);
  lines.push("");
  lines.push("| Field | Ground truth | Model output | Confidence | Grade | Note |");
  lines.push("|---|---|---|---|---|---|");

  // doc_type
  const dt = gradeStr(classify.doc_type, fx.doc_type, []);
  stats[dt.grade]++;
  lines.push(`| doc_type | ${fx.doc_type} | ${classify.doc_type} | ${classify.doc_type_confidence} | ${dt.grade} | ${dt.note} |`);

  for (const key of ["manufacturer", "model_number", "description", "spec_section_ref"]) {
    const t = fx.attributes[key];
    const m = extract.attributes[key];
    const g = gradeStr(m.value, t.canonical, t.acceptable_variants ?? []);
    stats[g.grade]++;
    const expected = t.canonical === null ? "null" : `"${t.canonical}"`;
    const got = m.value === null ? "null" : `"${m.value}"`;
    lines.push(`| ${key} | ${expected} | ${got} | ${m.confidence} | ${g.grade} | ${g.note} |`);
  }
  lines.push("");
}

const total = stats.correct + stats.acceptable + stats.incorrect;
const pctCorrect = ((stats.correct / total) * 100).toFixed(0);
const pctOk = (((stats.correct + stats.acceptable) / total) * 100).toFixed(0);

lines.push("## Summary");
lines.push("");
lines.push(`- Total graded fields: **${total}** (3 PDFs × 5 fields each = 15)`);
lines.push(`- Correct: **${stats.correct}** (${pctCorrect}%)`);
lines.push(`- Acceptable (matched a variant): **${stats.acceptable}**`);
lines.push(`- Incorrect: **${stats.incorrect}**`);
lines.push(`- Correct + acceptable: **${pctOk}%**`);
lines.push("");
lines.push(`Phase-0 gate per step-8-buildplan.md: doc_type accuracy ≥80% on the 3-PDF set. ${stats.incorrect === 0 ? "**PASSED.**" : "See incorrect rows above."}`);

await writeFile(path.join(outDir, "ACCURACY.md"), lines.join("\n"));
console.log(`Wrote out/ACCURACY.md`);
console.log(`  correct: ${stats.correct}/${total} (${pctCorrect}%), correct+acceptable: ${pctOk}%`);
