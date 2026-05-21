import http from 'node:http';
import PgBoss from 'pg-boss';

import {
  createQueuedProcessingJobAttempt,
  getDb,
  getLatestProcessingJob,
} from '@submittal/db';
import { createAnthropicAiClient } from '@submittal/shared/ai';
import { createTextractOcrClient } from '@submittal/shared/ocr';
import { createS3Storage } from '@submittal/shared/storage';

import { env } from './env.js';
import { initSentry, Sentry } from './sentry.js';
import { runBatchOrderJob } from './jobs/batch-order.js';
import { runClassifyJob } from './jobs/classify.js';
import { runExtractJob } from './jobs/extract.js';
import { runOcrJob } from './jobs/ocr.js';
import { runRenderExportJob } from './jobs/render-export.js';
import type { JobKind, RenderExportJobData, SourcePdfJobData } from './jobs/common.js';

initSentry();

const boss = new PgBoss({
  connectionString: env.databaseUrlDirect,
  retentionDays: 14,
  archiveCompletedAfterSeconds: 60 * 60 * 24,
});

const db = getDb({ url: env.databaseUrlDirect, max: 10 });

const storage = env.s3Bucket
  ? createS3Storage({
      bucket: env.s3Bucket,
      region: env.awsRegion,
    })
  : null;

const ai = env.anthropicApiKey
  ? createAnthropicAiClient({
      apiKey: env.anthropicApiKey,
      classifyModel: env.anthropicClassifyModel,
      extractModel: env.anthropicExtractModel,
    })
  : null;

const ocr = createTextractOcrClient({ region: env.awsRegion });
const queues = ['ocr', 'classify', 'extract', 'batch_order', 'render_export'] as const;

boss.on('error', (err) => {
  console.error({ level: 'error', component: 'pg-boss', err: String(err) });
  Sentry.captureException(err);
});

async function enqueueChainedJob(kind: JobKind, data: SourcePdfJobData) {
  const sourcePdfId = kind === 'batch_order' ? null : data.sourcePdfId;
  const latest = await getLatestProcessingJob(db, {
    packageId: data.packageId,
    kind,
    sourcePdfId,
  });
  if (latest && ['queued', 'running', 'succeeded'].includes(latest.status)) {
    return;
  }

  await createQueuedProcessingJobAttempt(db, {
    packageId: data.packageId,
    sourcePdfId,
    kind,
  });

  await boss.send(kind, data, {
    singletonKey: `${kind}:${sourcePdfId ?? data.packageId}`,
    retryLimit: 3,
    retryBackoff: true,
  });
}

function requireStorage() {
  if (!storage) throw new Error('Missing S3_BUCKET or S3_BUCKET_DEV for worker storage');
  return storage;
}

function requireAi() {
  if (!ai) throw new Error('Missing ANTHROPIC_API_KEY for AI worker jobs');
  return ai;
}

async function registerWorkers() {
  await Promise.all(
    queues.map((name) =>
      boss.createQueue(name, {
        name,
        retryLimit: 3,
        retryBackoff: true,
      }),
    ),
  );

  await boss.work<SourcePdfJobData>('ocr', { batchSize: env.concurrency.ocr }, async (jobs) => {
    for (const job of jobs) {
      await runOcrJob(
        {
          db,
          storage: requireStorage(),
          bucket: env.s3Bucket,
          ocr,
          enqueue: async (name, data) => {
            await enqueueChainedJob(name as JobKind, data);
          },
        },
        job.data,
      );
    }
  });

  await boss.work<SourcePdfJobData>(
    'classify',
    { batchSize: env.concurrency.classify },
    async (jobs) => {
      for (const job of jobs) {
        await runClassifyJob(
          {
            db,
            storage: requireStorage(),
            ai: requireAi(),
          },
          job.data,
        );
        await enqueueChainedJob('extract', job.data);
      }
    },
  );

  await boss.work<SourcePdfJobData>('extract', { batchSize: env.concurrency.extract }, async (jobs) => {
    for (const job of jobs) {
        await runExtractJob(
          {
            db,
            storage: requireStorage(),
            ai: requireAi(),
            enqueue: async (name, data) => {
              await enqueueChainedJob(name, data);
            },
          },
          job.data,
        );
    }
  });

  await boss.work<{ workspaceId: string; packageId: string }>('batch_order', async (jobs) => {
    for (const job of jobs) {
      await runBatchOrderJob({ db }, job.data);
    }
  });

  await boss.work<RenderExportJobData>('render_export', async (jobs) => {
    for (const job of jobs) {
      await runRenderExportJob({ db, storage: requireStorage() }, job.data);
    }
  });
}

async function queueDepthByTopic() {
  const entries = await Promise.all(
    queues.map(async (topic) => [topic, await boss.getQueueSize(topic)] as const),
  );
  return Object.fromEntries(entries);
}

async function startHealthz(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        void queueDepthByTopic()
          .then((depth) => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'ok',
                ts: new Date().toISOString(),
                queue_depth_by_topic: depth,
                error_rate_5m: 0,
                oldest_job_age_s: 0,
              }),
            );
          })
          .catch((err) => {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', error: String(err) }));
          });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'not_found' } }));
    });
    server.listen(env.healthzPort, () => {
      console.log({ level: 'info', msg: `healthz listening on :${env.healthzPort}` });
      resolve(server);
    });
  });
}

async function main(): Promise<void> {
  console.log({ level: 'info', msg: 'worker: booting', node_env: env.NODE_ENV });
  await boss.start();
  await registerWorkers();
  console.log({ level: 'info', msg: 'worker: pg-boss started and workers registered' });
  const server = await startHealthz();

  const shutdown = async (signal: string) => {
    console.log({ level: 'info', msg: `worker: ${signal} received, shutting down` });
    server.close();
    try {
      await boss.stop({ graceful: true, timeout: 10_000 });
    } catch (err) {
      console.error({ level: 'error', msg: 'pg-boss stop failed', err: String(err) });
    }
    if (env.sentryDsn) {
      try {
        await Sentry.close(2_000);
      } catch {
        /* exiting anyway */
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error({ level: 'fatal', msg: 'worker: failed to boot', err: String(err) });
  Sentry.captureException(err);
  process.exit(1);
});
