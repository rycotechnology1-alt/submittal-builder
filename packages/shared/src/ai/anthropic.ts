import Anthropic from '@anthropic-ai/sdk';
import type { Message, Tool } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';

import { CLASSIFY_SYSTEM_PROMPT, CLASSIFY_TOOL, EXTRACT_SYSTEM_PROMPT, EXTRACT_TOOL } from './prompts.js';

const docTypeSchema = z.enum([
  'product_data',
  'cut_sheet',
  'warranty',
  'shop_drawing',
  'sds',
  'installation',
  'test_report',
  'other',
]);

export const classifyResultSchema = z.object({
  doc_type: docTypeSchema,
  confidence: z.number().min(0).max(1),
});

const extractedFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  source_page: z.number().int().min(1),
});

const extractedVariantSchema = z.object({
  part_number: z.string().min(1),
  size: z.string().min(1),
  secondary_dims: z
    .object({
      type: z.string().optional(),
      packaging: z.string().optional(),
      length: z.string().optional(),
    })
    .nullish(),
  source_page: z.number().int().min(1),
});

export const extractResultSchema = z.object({
  manufacturer: extractedFieldSchema,
  model_number: extractedFieldSchema,
  description: extractedFieldSchema,
  spec_section_ref: extractedFieldSchema,
  // Older prompt responses (or single-product sheets) may omit variants.
  variants: z.array(extractedVariantSchema).default([]),
});

export type ExtractedVariant = z.infer<typeof extractedVariantSchema>;

export type ClassifyResult = z.infer<typeof classifyResultSchema>;
export type ExtractResult = z.infer<typeof extractResultSchema>;

export type AnthropicAiClient = {
  classifyDocument(input: { images: Uint8Array[] }): Promise<ClassifyResult>;
  extractAttributes(input: { images: Uint8Array[] }): Promise<ExtractResult>;
};

type AnthropicAiConfig = {
  apiKey: string;
  classifyModel?: string;
  extractModel?: string;
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number; response?: { status?: number } })?.status;
      const nestedStatus = (error as { response?: { status?: number } })?.response?.status;
      const retryable = status === 429 || status === 529 || nestedStatus === 429 || nestedStatus === 529;
      if (!retryable || attempt === 3) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function imageContent(images: Uint8Array[]) {
  return images.map((image) => ({
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/webp' as const,
      data: Buffer.from(image).toString('base64'),
    },
  }));
}

function toolInput(resp: Message, toolName: string): unknown {
  const block = resp.content.find((item) => item.type === 'tool_use' && item.name === toolName);
  if (!block || block.type !== 'tool_use') {
    throw new Error(`Anthropic response did not include ${toolName} tool_use`);
  }
  return block.input;
}

export function createAnthropicAiClient(config: AnthropicAiConfig): AnthropicAiClient {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    async classifyDocument(input) {
      const resp = await withRetry<Message>(
        () =>
          client.messages.create({
          model: config.classifyModel ?? DEFAULT_MODEL,
          max_tokens: 512,
          stream: false,
          system: [
            {
              type: 'text',
              text: CLASSIFY_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: [CLASSIFY_TOOL as Tool],
          tool_choice: { type: 'tool', name: CLASSIFY_TOOL.name },
          messages: [{ role: 'user', content: imageContent(input.images) }],
        }) as unknown as Promise<Message>,
      );
      return classifyResultSchema.parse(toolInput(resp, CLASSIFY_TOOL.name));
    },

    async extractAttributes(input) {
      const resp = await withRetry<Message>(
        () =>
          client.messages.create({
          model: config.extractModel ?? DEFAULT_MODEL,
          max_tokens: 4096,
          stream: false,
          system: [
            {
              type: 'text',
              text: EXTRACT_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          tools: [EXTRACT_TOOL as Tool],
          tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
          messages: [{ role: 'user', content: imageContent(input.images) }],
        }) as unknown as Promise<Message>,
      );
      return extractResultSchema.parse(toolInput(resp, EXTRACT_TOOL.name));
    },
  };
}
