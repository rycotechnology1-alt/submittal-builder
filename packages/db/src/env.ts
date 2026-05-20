// Loads the repo-root .env.local + .env into process.env.
// Drizzle scripts (migrate, seed, drizzle-kit) cwd into packages/db, so the
// default `dotenv/config` (which reads cwd/.env) misses the repo-root files.

import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

config({ path: path.join(repoRoot, '.env.local'), override: false });
config({ path: path.join(repoRoot, '.env'), override: false });
