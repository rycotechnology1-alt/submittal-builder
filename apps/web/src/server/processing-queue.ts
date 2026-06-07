import PgBoss from 'pg-boss';

import { env } from '@/env';

type ProcessingQueue = {
  send(name: string, data: object, options: PgBoss.SendOptions): Promise<string | null>;
};

let boss: PgBoss | null = null;
let started: Promise<PgBoss> | null = null;
const queues = [
  'ocr',
  'classify',
  'extract',
  'batch_order',
  'render_export',
  'saved_item_process',
] as const;

async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  if (!started) {
    const instance = new PgBoss({
      connectionString: env.DATABASE_URL_DIRECT_DEV ?? env.databaseUrl,
      retentionDays: 14,
      archiveCompletedAfterSeconds: 60 * 60 * 24,
    });
    instance.on('error', (err) => {
      console.error({ level: 'error', component: 'pg-boss', err: String(err) });
    });
    started = instance.start().then(async () => {
      await Promise.all(
        queues.map((name) =>
          instance.createQueue(name, {
            name,
            retryLimit: 3,
            retryBackoff: true,
          }),
        ),
      );
      boss = instance;
      return instance;
    });
  }
  return started;
}

export function getProcessingQueue(): ProcessingQueue {
  return {
    async send(name, data, options) {
      const client = await getBoss();
      return client.send(name, data, options);
    },
  };
}
