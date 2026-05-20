// One-shot verifier: count rows in every domain table and prove the schema
// reached the target DB. Used during Phase 1 verification; safe to delete
// after handoff.

import './env.js';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

const url = process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error('verify: DATABASE_URL_DIRECT_DEV (or DATABASE_URL_DIRECT) is required');
  process.exit(1);
}

const expected = [
  'workspaces',
  'users',
  'sessions',
  'accounts',
  'verifications',
  'projects',
  'packages',
  'source_pdfs',
  'source_pages',
  'items',
  'item_attributes',
  'exports',
  'processing_jobs',
];

const pool = new Pool({ connectionString: url, max: 1 });
try {
  const { rows } = await pool.query<{ table_name: string; row_count: string }>(
    `SELECT t.table_name,
            (xpath('/row/c/text()',
                   query_to_xml(format('SELECT count(*) AS c FROM %I', t.table_name),
                                false, true, '')))[1]::text AS row_count
     FROM information_schema.tables t
     WHERE t.table_schema = 'public' AND t.table_name = ANY($1)
     ORDER BY t.table_name`,
    [expected],
  );
  const found = rows.map((r) => r.table_name);
  const missing = expected.filter((t) => !found.includes(t));
  console.log(`verify: target ${new URL(url).host}`);
  console.log(`verify: ${found.length}/${expected.length} tables present`);
  for (const r of rows) console.log(`  ${r.table_name.padEnd(20)} rows=${r.row_count}`);
  if (missing.length > 0) {
    console.error(`verify: MISSING tables: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('verify: ok');
  }
} catch (err) {
  console.error('verify: failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
