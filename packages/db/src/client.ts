// Drizzle client backed by @neondatabase/serverless.
//
// Works in three runtimes:
//   - Vercel serverless (web app)        → uses Neon's HTTP/WebSocket transport
//   - Local dev / `pnpm dev`             → same driver, hits Neon over wss
//   - Fly worker (Phase 4+)              → same driver, persistent ws connection
//
// We deliberately use a single driver for all environments so the worker and
// web can share `@submittal/db` without conditional imports.

import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema.js';

// Node runtimes don't have a global WebSocket; wire the `ws` polyfill once.
// On Vercel's serverless runtime, the platform provides a global WebSocket
// and this assignment is a no-op (overwriting the global is allowed).
if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

type DbConfig = {
  /** Defaults to process.env.DATABASE_URL. */
  url?: string;
  /** Max pool size. Defaults to 1 for serverless, override for the worker. */
  max?: number;
};

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb(config: DbConfig = {}) {
  if (cached) return cached;
  const url = config.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '@submittal/db: DATABASE_URL must be set (or pass `url` to getDb()).',
    );
  }
  const pool = new Pool({ connectionString: url, max: config.max ?? 1 });
  cached = drizzle(pool, { schema });
  return cached;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
