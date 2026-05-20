import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
// override: true so the spike's .env wins over any pre-existing empty Windows user env var.
dotenv.config({ override: true });

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const MODEL = "claude-sonnet-4-6";

export async function imageBlock(pngPath) {
  const data = await readFile(pngPath);
  return {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: data.toString("base64") },
  };
}

// Retry per step-7 §6: 3 attempts with exponential backoff on 429/529.
async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.status ?? err?.response?.status;
      const retryable = status === 429 || status === 529 || status === 503;
      if (!retryable || attempt === 3) throw err;
      const backoffMs = 1000 * 2 ** (attempt - 1);
      console.warn(`  [${label}] attempt ${attempt} got ${status}, retrying in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

export async function callModel({ systemPrompt, userContent, tool, label }) {
  return withRetry(async () => {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Mark the system prompt block as cache-eligible per step-7 §6.
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = resp.content.find((b) => b.type === "tool_use");
    if (!toolUse) throw new Error(`No tool_use block in response for ${label}`);

    return {
      input: toolUse.input,
      usage: resp.usage,
      stop_reason: resp.stop_reason,
    };
  }, label);
}
