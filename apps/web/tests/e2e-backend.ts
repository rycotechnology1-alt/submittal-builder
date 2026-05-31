/**
 * Phase 6 end-to-end backend smoke.
 *
 * Runs: signup → project → package → upload 2 PDFs → process → poll →
 *       edit one attribute → export → poll → download → assert SHA-256s.
 *
 * Both the web app and the worker must be running, against a DB the smoke can
 * also reach directly (it bypasses the "verify email" link by stamping
 * email_verified=true in Postgres). Invoke via the shell wrapper:
 *
 *   apps/web/tests/e2e-backend.sh
 *
 * Or directly with pnpm:
 *
 *   pnpm --filter @submittal/web run smoke:e2e
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@submittal/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });

const baseUrl = process.env.E2E_BASE_URL ?? process.env.PHASE4_SMOKE_BASE_URL ?? 'http://localhost:3000';
const workerUrl =
  process.env.E2E_WORKER_URL ?? process.env.PHASE4_SMOKE_WORKER_URL ?? 'http://localhost:8080';
const password = `e2e-${Date.now()}-pass`;
const email = `e2e-${Date.now()}@example.test`;
const dbUrl =
  process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLED_DEV ?? process.env.DATABASE_URL_DIRECT_DEV;

if (!dbUrl) {
  throw new Error('Set DATABASE_URL, DATABASE_URL_POOLED_DEV, or DATABASE_URL_DIRECT_DEV');
}

const db = getDb({ url: dbUrl, max: 1 });

type Json = Record<string, unknown>;

class CookieJar {
  private readonly store = new Map<string, string>();
  ingest(res: Response) {
    const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const cookies = getSetCookie?.call(res.headers) ?? [];
    const fallback = res.headers.get('set-cookie');
    for (const raw of cookies.length > 0 ? cookies : fallback ? [fallback] : []) {
      const [pair] = raw.split(';');
      if (!pair) continue;
      const eqAt = pair.indexOf('=');
      if (eqAt < 0) continue;
      const name = pair.slice(0, eqAt).trim();
      const value = pair.slice(eqAt + 1).trim();
      if (name && value && value !== 'deleted') this.store.set(name, value);
    }
  }
  header() {
    return [...this.store.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
  }
}

const jar = new CookieJar();

function url(p: string) {
  return new URL(p, baseUrl).toString();
}

async function jsonOf<T = Json>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? (JSON.parse(text) as T) : ({} as T);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.url}\n${JSON.stringify(body, null, 2)}`);
  }
  jar.ingest(res);
  return body;
}

async function post<T = Json>(pathname: string, payload: unknown = {}): Promise<T> {
  return jsonOf<T>(
    await fetch(url(pathname), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        cookie: jar.header(),
        'idempotency-key': `e2e-${crypto.randomUUID()}`,
      },
      body: JSON.stringify(payload),
    }),
  );
}

async function put<T = Json>(pathname: string, payload: unknown = {}): Promise<T> {
  return jsonOf<T>(
    await fetch(url(pathname), {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        cookie: jar.header(),
        'idempotency-key': `e2e-${crypto.randomUUID()}`,
      },
      body: JSON.stringify(payload),
    }),
  );
}

async function get<T = Json>(pathname: string): Promise<T> {
  return jsonOf<T>(
    await fetch(url(pathname), {
      headers: { origin: baseUrl, cookie: jar.header() },
    }),
  );
}

async function waitForHttp(target: string, label: string) {
  try {
    const res = await fetch(target);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(`${label} unreachable at ${target}: ${String(err)}`);
  }
}

async function verifyEmail() {
  await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
}

function sha256(bytes: Uint8Array | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function uploadPdf(packageId: string, fixturePath: string) {
  const bytes = new Uint8Array(await readFile(fixturePath));
  const file = await stat(fixturePath);
  const filename = path.basename(fixturePath);
  const digest = sha256(Buffer.from(bytes));

  const presign = await post<{
    source_pdf_id: string;
    upload_url: string;
    required_headers: Record<string, string>;
  }>(`/api/v1/packages/${packageId}/source-pdfs/presign`, {
    filename,
    byte_size: file.size,
    content_type: 'application/pdf',
  });

  const putRes = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: presign.required_headers,
    body: bytes,
  });
  if (!putRes.ok) throw new Error(`S3 upload failed for ${filename}: HTTP ${putRes.status}`);

  await post(`/api/v1/packages/${packageId}/source-pdfs/${presign.source_pdf_id}/confirm`, {});
  return { sourcePdfId: presign.source_pdf_id, sha256: digest, filename };
}

async function pollReady(packageId: string, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const status = await get<{
      status: string;
      source_pdfs: Array<{ id: string; processing_status: string }>;
    }>(`/api/v1/packages/${packageId}/status`);
    last = status;
    if (status.source_pdfs.some((p) => p.processing_status === 'error')) {
      throw new Error(`Processing failed:\n${JSON.stringify(status, null, 2)}`);
    }
    if (status.status === 'ready') return status;
    console.log(`[e2e] package status=${status.status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for package ready:\n${JSON.stringify(last, null, 2)}`);
}

async function pollExportReady(exportId: string, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const row = await get<{ status: string; byte_size: number | null; page_count: number | null }>(
      `/api/v1/exports/${exportId}`,
    );
    last = row;
    if (row.status === 'ready') return row;
    if (row.status === 'failed') throw new Error(`Export failed: ${JSON.stringify(row, null, 2)}`);
    console.log(`[e2e] export status=${row.status}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Timed out waiting for export ready:\n${JSON.stringify(last, null, 2)}`);
}

async function downloadBytes(presigned: string): Promise<Uint8Array> {
  const res = await fetch(presigned);
  if (!res.ok) throw new Error(`Presigned GET failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return new Uint8Array(buf);
}

async function main() {
  await waitForHttp(url('/api/v1/healthz'), 'web');
  await waitForHttp(new URL('/healthz', workerUrl).toString(), 'worker');

  console.log(`[e2e] signing up ${email}`);
  await post('/api/v1/auth/signup', {
    email,
    password,
    name: 'E2E Smoke',
    workspace_name: 'E2E Smoke Workspace',
    sub_company_name: 'E2E Smoke Sub',
  });
  await verifyEmail();
  await post('/api/v1/auth/sign-in/email', { email, password });

  console.log('[e2e] creating project + package');
  const project = await post<{ id: string }>('/api/v1/projects', {
    name: 'E2E Smoke Project',
    project_number: 'E2E-1',
    gc_name: 'E2E GC',
    architect_name: 'E2E Architect',
  });
  const pkg = await post<{ id: string }>(`/api/v1/projects/${project.id}/packages`, {
    submittal_number: '23 81 00-E2E',
    spec_section: '23 81 00',
    title: 'E2E Smoke Package',
  });

  const fixtures = [
    path.join(__dirname, '__fixtures__', '01-daikin-vrv-cutsheet.pdf'),
    path.join(__dirname, '__fixtures__', '02-hardie-warranty.pdf'),
  ];

  console.log('[e2e] uploading fixtures');
  const uploaded = [] as Awaited<ReturnType<typeof uploadPdf>>[];
  for (const fixture of fixtures) {
    uploaded.push(await uploadPdf(pkg.id, fixture));
  }

  console.log('[e2e] starting processing');
  await post(`/api/v1/packages/${pkg.id}/process`, {});
  await pollReady(pkg.id);

  console.log('[e2e] verifying SHA-256 of source PDFs round-trips unchanged');
  for (const item of uploaded) {
    const dl = await get<{ url: string }>(`/api/v1/source-pdfs/${item.sourcePdfId}/download`);
    const bytes = await downloadBytes(dl.url);
    const got = sha256(Buffer.from(bytes));
    if (got !== item.sha256) {
      throw new Error(
        `SHA-256 drift for ${item.filename}: uploaded=${item.sha256} downloaded=${got}`,
      );
    }
  }

  console.log('[e2e] editing one attribute');
  const items = await get<Array<{ item: { id: string }; attributes: Array<{ key: string; current_value: string | null; original_ai_value: string | null }> }>>(
    `/api/v1/packages/${pkg.id}/items`,
  );
  if (items.length === 0) throw new Error('No items returned for package');
  const target = items[0]!;
  const beforeAttr = target.attributes.find((a) => a.key === 'manufacturer') ?? target.attributes[0];
  if (!beforeAttr) throw new Error('Target item has no attributes to edit');
  const edited = `${beforeAttr.current_value ?? ''} (edited by e2e)`;
  const after = await put<{ current_value: string; original_ai_value: string | null; edited_by_user_at: string | null }>(
    `/api/v1/items/${target.item.id}/attributes/${beforeAttr.key}`,
    { value: edited },
  );
  if (after.current_value !== edited) {
    throw new Error(`PUT attribute didn't persist: ${JSON.stringify(after, null, 2)}`);
  }
  if (after.original_ai_value !== beforeAttr.original_ai_value) {
    throw new Error('original_ai_value mutated after edit');
  }
  if (!after.edited_by_user_at) {
    throw new Error('edited_by_user_at not stamped');
  }

  console.log('[e2e] starting export');
  const exportRes = await post<{ export_id: string }>(`/api/v1/packages/${pkg.id}/exports`, {
    bates_prefix: 'E2E-',
  });
  const exportRow = await pollExportReady(exportRes.export_id);

  console.log('[e2e] downloading export');
  const dl = await get<{ url: string }>(`/api/v1/exports/${exportRes.export_id}/download`);
  const exportBytes = await downloadBytes(dl.url);
  if (exportBytes.byteLength === 0) throw new Error('Downloaded export is empty');
  if (exportRow.byte_size && exportRow.byte_size !== exportBytes.byteLength) {
    throw new Error(
      `Export byte_size mismatch: db=${exportRow.byte_size} downloaded=${exportBytes.byteLength}`,
    );
  }
  const exportSha = sha256(Buffer.from(exportBytes));

  console.log('[e2e] re-edit after export should now succeed (no lock)');
  const reEditRes = await fetch(url(`/api/v1/items/${target.item.id}/attributes/${beforeAttr.key}`), {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      origin: baseUrl,
      cookie: jar.header(),
    },
    body: JSON.stringify({ value: `${edited} (post-export)` }),
  });
  if (reEditRes.status !== 200) {
    throw new Error(`Expected 200 on post-export edit, got ${reEditRes.status}`);
  }

  console.log('[e2e] second export under a bumped revision');
  const exportRes2 = await post<{ export_id: string }>(`/api/v1/packages/${pkg.id}/exports`, {
    revision: 'R1',
  });
  await pollExportReady(exportRes2.export_id);

  console.log('[e2e] export history lists both revisions');
  const history = await get<Array<{ id: string; status: string; revision: string | null }>>(
    `/api/v1/packages/${pkg.id}/exports`,
  );
  const readyRevisions = history.filter((e) => e.status === 'ready').map((e) => e.revision);
  if (!readyRevisions.includes('R0') || !readyRevisions.includes('R1')) {
    throw new Error(`Expected R0 and R1 in export history, got ${JSON.stringify(readyRevisions)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        package_id: pkg.id,
        item_count: items.length,
        edited_attribute: { item_id: target.item.id, key: beforeAttr.key },
        export_id: exportRes.export_id,
        export_id_r1: exportRes2.export_id,
        export_byte_size: exportBytes.byteLength,
        export_page_count: exportRow.page_count,
        export_sha256: exportSha,
        source_pdfs: uploaded.map((u) => ({ id: u.sourcePdfId, sha256: u.sha256 })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
