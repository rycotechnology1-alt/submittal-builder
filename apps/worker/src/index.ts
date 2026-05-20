// Phase 1 worker bootstrap.
//
// Today this only:
//   - boots pg-boss against the direct Postgres URL (Phase 4 wires topic
//     subscribers on top of it)
//   - serves /healthz so Fly's [checks] can verify liveness
//   - installs Sentry for unhandled errors
//   - handles SIGINT/SIGTERM with a graceful pg-boss shutdown
//
// Job consumers (ocr, classify, extract, batch_order, render_export) arrive
// in Phases 4 and 5.

import http from 'node:http';
import PgBoss from 'pg-boss';

import { env } from './env.js';
import { initSentry, Sentry } from './sentry.js';

initSentry();

const boss = new PgBoss({
  connectionString: env.databaseUrlDirect,
  // Keep job retention conservative until Phase 4 sizes it for real volume.
  retentionDays: 14,
  archiveCompletedAfterSeconds: 60 * 60 * 24,
});

boss.on('error', (err) => {
  console.error({ level: 'error', component: 'pg-boss', err: String(err) });
  Sentry.captureException(err);
});

async function startHealthz(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            ts: new Date().toISOString(),
            // Phase 1: empty placeholders. Phase 6 fills these in with real
            // queue depth + error rate aggregations.
            queue_depth_by_topic: {},
            error_rate_5m: 0,
            oldest_job_age_s: 0,
          }),
        );
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
  console.log({ level: 'info', msg: 'worker: pg-boss started' });
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
        /* swallow — exiting anyway */
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
