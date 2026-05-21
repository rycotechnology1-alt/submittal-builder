import {
  GetDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommand,
  TextractClient,
  type Block,
} from '@aws-sdk/client-textract';

export type TextractOcrClient = {
  detectPdfText(input: { bucket: string; key: string }): Promise<{
    raw: unknown;
    pages: Array<{ pageNumber: number; text: string }>;
  }>;
};

export type TextractOcrConfig = {
  region: string;
  pollIntervalMs?: number;
  maxPolls?: number;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pagesFromBlocks(blocks: Block[] = []) {
  const byPage = new Map<number, string[]>();
  for (const block of blocks) {
    if (block.BlockType !== 'LINE' || !block.Text || !block.Page) continue;
    const lines = byPage.get(block.Page) ?? [];
    lines.push(block.Text);
    byPage.set(block.Page, lines);
  }
  return [...byPage.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pageNumber, lines]) => ({ pageNumber, text: lines.join('\n') }));
}

export function createTextractOcrClient(config: TextractOcrConfig): TextractOcrClient {
  const client = new TextractClient({ region: config.region });

  return {
    async detectPdfText(input) {
      const started = await client.send(
        new StartDocumentTextDetectionCommand({
          DocumentLocation: {
            S3Object: {
              Bucket: input.bucket,
              Name: input.key,
            },
          },
        }),
      );
      if (!started.JobId) throw new Error('Textract did not return a JobId');

      const pollIntervalMs = config.pollIntervalMs ?? 3000;
      const maxPolls = config.maxPolls ?? 120;
      const blocks: Block[] = [];
      const rawPages: unknown[] = [];
      let nextToken: string | undefined;

      for (let poll = 0; poll < maxPolls; poll++) {
        const page = await client.send(
          new GetDocumentTextDetectionCommand({
            JobId: started.JobId,
            NextToken: nextToken,
          }),
        );
        rawPages.push(page);

        if (page.JobStatus === 'FAILED' || page.JobStatus === 'PARTIAL_SUCCESS') {
          throw new Error(page.StatusMessage ?? `Textract ${page.JobStatus}`);
        }

        if (page.JobStatus === 'SUCCEEDED') {
          blocks.push(...(page.Blocks ?? []));
          nextToken = page.NextToken;
          if (!nextToken) return { raw: rawPages, pages: pagesFromBlocks(blocks) };
          continue;
        }

        await sleep(pollIntervalMs);
      }

      throw new Error(`Textract polling exceeded ${maxPolls} attempts`);
    },
  };
}
