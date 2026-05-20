// Local-dev seed. One workspace, one user, one project, one empty package.
//
// Idempotent: re-running upserts on the user's email. Safe to run against
// the Neon dev branch; refuses to run if NODE_ENV=production.

import './env.js';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq } from 'drizzle-orm';
import ws from 'ws';
import * as schema from './schema.js';

if (typeof globalThis.WebSocket === 'undefined') {
  neonConfig.webSocketConstructor = ws;
}

if (process.env.NODE_ENV === 'production') {
  console.error('seed: refusing to run with NODE_ENV=production');
  process.exit(1);
}

const url = process.env.DATABASE_URL_DIRECT_DEV ?? process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error('seed: DATABASE_URL_DIRECT_DEV (or DATABASE_URL_DIRECT) is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: url, max: 1 });
const db = drizzle(pool, { schema });

const DEMO_EMAIL = 'demo@local';

try {
  const existing = await db
    .select({ id: schema.users.id, workspaceId: schema.users.workspaceId })
    .from(schema.users)
    .where(eq(schema.users.email, DEMO_EMAIL))
    .limit(1);

  let workspaceId: string;
  if (existing.length > 0 && existing[0]) {
    workspaceId = existing[0].workspaceId;
    console.log(`seed: demo user already exists, workspaceId=${workspaceId}`);
  } else {
    const [ws_] = await db
      .insert(schema.workspaces)
      .values({ name: 'Demo Workspace', subCompanyName: 'Demo Sub Co.' })
      .returning({ id: schema.workspaces.id });
    if (!ws_) throw new Error('seed: workspace insert returned no row');
    workspaceId = ws_.id;
    await db.insert(schema.users).values({
      workspaceId,
      email: DEMO_EMAIL,
      name: 'Demo User',
      emailVerified: true,
    });
    console.log(`seed: created workspace ${workspaceId} + user ${DEMO_EMAIL}`);
  }

  const projects = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.workspaceId, workspaceId))
    .limit(1);
  let projectId: string;
  if (projects.length > 0 && projects[0]) {
    projectId = projects[0].id;
  } else {
    const [p] = await db
      .insert(schema.projects)
      .values({ workspaceId, name: 'Demo Project', projectNumber: 'DEMO-001' })
      .returning({ id: schema.projects.id });
    if (!p) throw new Error('seed: project insert returned no row');
    projectId = p.id;
    console.log(`seed: created project ${projectId}`);
  }

  const packages = await db
    .select({ id: schema.packages.id })
    .from(schema.packages)
    .where(eq(schema.packages.projectId, projectId))
    .limit(1);
  if (packages.length === 0) {
    const [pkg] = await db
      .insert(schema.packages)
      .values({
        workspaceId,
        projectId,
        submittalNumber: '09 51 13-001',
        specSection: '09 51 13',
        title: 'Demo Package',
      })
      .returning({ id: schema.packages.id });
    if (!pkg) throw new Error('seed: package insert returned no row');
    console.log(`seed: created package ${pkg.id}`);
  } else {
    console.log('seed: demo package already exists');
  }

  console.log('seed: ok');
} catch (err) {
  console.error('seed: failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
