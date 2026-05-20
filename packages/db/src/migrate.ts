// Programmatic migrator. Run via `pnpm db:migrate`.
//
// Reads DATABASE_URL_DIRECT_DEV (or DATABASE_URL_DIRECT) from the repo-root
// .env.local. We use the DIRECT URL — not the pooled one — because Drizzle's
// migrator opens a long-lived connection and runs DDL inside a transaction,
// which Neon's PgBouncer pooler does not support in transaction mode.

import './env.js';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ws from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

const url = process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error('migrate: DATABASE_URL_DIRECT_DEV (or DATABASE_URL_DIRECT) is required');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '..', 'drizzle');

console.log(`migrate: applying migrations from ${migrationsFolder}`);
console.log(`migrate: target host = ${new URL(url).host}`);

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  console.log('migrate: ok');
} catch (err) {
  console.error('migrate: failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
