import { config as loadEnv } from 'dotenv';
import { eq } from 'drizzle-orm';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, schema } from '@submittal/db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');

loadEnv({ path: path.join(repoRoot, '.env.local'), override: false });
loadEnv({ path: path.join(repoRoot, '.env'), override: false });

const baseUrl = process.env.PHASE4_SMOKE_BASE_URL ?? 'http://localhost:3000';
const workerUrl = process.env.PHASE4_SMOKE_WORKER_URL ?? 'http://localhost:8080';
const password = `phase4-smoke-${Date.now()}-pass`;
const email = `phase4-smoke-${Date.now()}@example.test`;
const dbUrl =
  process.env.DATABASE_URL ?? process.env.DATABASE_URL_POOLED_DEV ?? process.env.DATABASE_URL_DIRECT_DEV;

if (!dbUrl) throw new Error('Set DATABASE_URL, DATABASE_URL_POOLED_DEV, or DATABASE_URL_DIRECT_DEV');

const db = getDb({ url: dbUrl, max: 1 });

type Json = Record<string, unknown>;

class SmokeCookieJar {
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
    return [...this.store.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

const jar = new SmokeCookieJar();

function url(pathname: string) {
  return new URL(pathname, baseUrl).toString();
}

async function jsonResponse<T = Json>(res: Response): Promise<T> {
  const text = await res.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.url}\n${JSON.stringify(json, null, 2)}`);
  }
  jar.ingest(res);
  return json;
}

async function post<T = Json>(pathname: string, body: unknown): Promise<T> {
  return jsonResponse<T>(
    await fetch(url(pathname), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        cookie: jar.header(),
        'idempotency-key': `smoke-${crypto.randomUUID()}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

async function get<T = Json>(pathname: string): Promise<T> {
  return jsonResponse<T>(
    await fetch(url(pathname), {
      headers: {
        origin: baseUrl,
        cookie: jar.header(),
      },
    }),
  );
}

async function waitForHttp(target: string, label: string) {
  try {
    const res = await fetch(target);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    throw new Error(
      `${label} is not reachable at ${target}. Start it first, then rerun this script. ${String(
        error,
      )}`,
    );
  }
}

async function verifySignupEmail() {
  await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
}

async function uploadPdf(packageId: string, fixturePath: string) {
  const bytes = new Uint8Array(await readFile(fixturePath));
  const file = await stat(fixturePath);
  const filename = path.basename(fixturePath);

  const presign = await post<{
    source_pdf_id: string;
    upload_url: string;
    required_headers: Record<string, string>;
  }>(`/api/v1/packages/${packageId}/source-pdfs/presign`, {
    filename,
    byte_size: file.size,
    content_type: 'application/pdf',
  });

  const put = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: presign.required_headers,
    body: bytes,
  });
  if (!put.ok) throw new Error(`S3 upload failed for ${filename}: HTTP ${put.status}`);

  await post(`/api/v1/packages/${packageId}/source-pdfs/${presign.source_pdf_id}/confirm`, {});
  return presign.source_pdf_id;
}

async function pollReady(packageId: string) {
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastStatus: unknown;

  while (Date.now() < deadline) {
    const status = await get<{
      status: string;
      source_pdfs: Array<{ id: string; processing_status: string; processing_error?: string | null }>;
      jobs_summary: { queued: number; running: number; failed: number };
    }>(`/api/v1/packages/${packageId}/status`);
    lastStatus = status;

    if (status.source_pdfs.some((pdf) => pdf.processing_status === 'error')) {
      throw new Error(`Processing failed:\n${JSON.stringify(status, null, 2)}`);
    }
    if (status.status === 'ready') return status;

    console.log(
      `[phase4-smoke] status=${status.status} jobs=${JSON.stringify(status.jobs_summary)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Timed out waiting for package ready:\n${JSON.stringify(lastStatus, null, 2)}`);
}

function assertItems(items: Array<{ item: Json; attributes: Array<Json>; source_pdfs: Array<Json> }>) {
  if (items.length === 0) throw new Error('No items were created');

  for (const row of items) {
    if (row.source_pdfs.length === 0) throw new Error(`Item has no source PDF: ${row.item.id}`);
    const byKey = new Map(row.attributes.map((attr) => [String(attr.key), attr]));
    for (const key of ['manufacturer', 'model_number', 'description', 'spec_section_ref']) {
      const attr = byKey.get(key);
      if (!attr) throw new Error(`Missing ${key} on item ${row.item.id}`);
      if (attr.current_value !== attr.original_ai_value) {
        throw new Error(`original_ai_value mismatch for ${key} on item ${row.item.id}`);
      }
      if (typeof attr.confidence !== 'number') {
        throw new Error(`Missing confidence for ${key} on item ${row.item.id}`);
      }
      if (attr.current_value !== null && typeof attr.source_page_id !== 'string') {
        throw new Error(`Missing source_page_id for ${key} on item ${row.item.id}`);
      }
    }
  }
}

async function main() {
  await waitForHttp(url('/api/v1/healthz'), 'web');
  await waitForHttp(new URL('/healthz', workerUrl).toString(), 'worker');

  console.log(`[phase4-smoke] signing up ${email}`);
  await post('/api/v1/auth/signup', {
    email,
    password,
    name: 'Phase 4 Smoke',
    workspace_name: 'Phase 4 Smoke Workspace',
    sub_company_name: 'Phase 4 Smoke Sub',
  });
  await verifySignupEmail();

  console.log('[phase4-smoke] signing in');
  await post('/api/v1/auth/sign-in/email', { email, password });

  console.log('[phase4-smoke] creating project/package');
  const project = await post<{ id: string }>('/api/v1/projects', {
    name: 'Phase 4 Smoke Project',
    project_number: 'SMOKE-4',
    gc_name: 'Smoke GC',
    architect_name: 'Smoke Architect',
  });
  const pkg = await post<{ id: string }>(`/api/v1/projects/${project.id}/packages`, {
    submittal_number: '23 81 00-SMOKE',
    spec_section: '23 81 00',
    title: 'Phase 4 Smoke Package',
  });

  const fixtures = [
    path.join(__dirname, '__fixtures__', '01-daikin-vrv-cutsheet.pdf'),
    path.join(__dirname, '__fixtures__', '02-hardie-warranty.pdf'),
  ];

  for (const fixture of fixtures) {
    console.log(`[phase4-smoke] uploading ${path.basename(fixture)}`);
    await uploadPdf(pkg.id, fixture);
  }

  console.log('[phase4-smoke] starting processing');
  await post(`/api/v1/packages/${pkg.id}/process`, {});
  await pollReady(pkg.id);

  const items = await get<Array<{ item: Json; attributes: Array<Json>; source_pdfs: Array<Json> }>>(
    `/api/v1/packages/${pkg.id}/items`,
  );
  assertItems(items);

  console.log(
    JSON.stringify(
      {
        ok: true,
        package_id: pkg.id,
        item_count: items.length,
        items: items.map((row) => ({
          id: row.item.id,
          title: row.item.title,
          doc_type: row.item.doc_type,
          source_pdf_count: row.source_pdfs.length,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
