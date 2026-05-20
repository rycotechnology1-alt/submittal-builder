import { config } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit cwds into packages/db; load .env.local from the repo root.
const repoRoot = path.resolve(process.cwd(), '..', '..');
config({ path: path.join(repoRoot, '.env.local'), override: false });
config({ path: path.join(repoRoot, '.env'), override: false });

const url = process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;
if (!url) {
  throw new Error(
    'drizzle.config.ts: DATABASE_URL_DIRECT_DEV (or DATABASE_URL_DIRECT) must be set',
  );
}

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
