import '@/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'phase-3-test-pass-1234';
const FIXTURE_PDF = path.resolve(
  process.cwd(),
  '..',
  '..',
  'spikes',
  'fixtures',
  '01-daikin-vrv-cutsheet.pdf',
);

type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

type StoredObject = {
  body: Uint8Array;
  contentType: string;
  byteSize: number;
};

class FakeStorage {
  readonly objects = new Map<string, StoredObject>();
  readonly deletedKeys: string[] = [];

  async presignPutUrl(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
    requiredHeaders: Record<string, string>;
  }) {
    return {
      url: `https://storage.test/put/${input.key}?ttl=${input.expiresInSeconds}`,
      requiredHeaders: input.requiredHeaders,
    };
  }

  async presignGetUrl(input: { key: string; expiresInSeconds: number }) {
    return `https://storage.test/get/${input.key}?ttl=${input.expiresInSeconds}`;
  }

  async headObject(key: string) {
    const object = this.objects.get(key);
    return object ? { byteSize: object.byteSize, contentType: object.contentType } : null;
  }

  async getObjectBytes(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Missing object ${key}`);
    return object.body;
  }

  async putObject(input: { key: string; body: Uint8Array; contentType: string }) {
    this.objects.set(input.key, {
      body: input.body,
      contentType: input.contentType,
      byteSize: input.body.byteLength,
    });
  }

  async deleteObject(key: string) {
    this.deletedKeys.push(key);
    this.objects.delete(key);
  }
}

const storage = new FakeStorage();

function ctx<T extends Record<string, string>>(params: T): RouteContext<T> {
  return { params: Promise.resolve(params) };
}

function fakeReq(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${pathname}`, init);
}

function jsonReq(pathname: string, cookie: string, body: unknown, method = 'POST'): Request {
  return fakeReq(pathname, {
    method,
    headers: {
      'content-type': 'application/json',
      cookie,
      origin: 'http://localhost:3000',
      'idempotency-key': `test-${randomUUID()}`,
    },
    body: JSON.stringify(body),
  });
}

function authedReq(pathname: string, cookie: string, init?: RequestInit): Request {
  return fakeReq(pathname, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie, origin: 'http://localhost:3000' },
  });
}

async function flipEmailVerified(email: string): Promise<void> {
  await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
}

async function loadRoutes() {
  vi.resetModules();
  vi.doMock('@/server/storage', () => ({
    getStorage: () => storage,
  }));

  const [
    signup,
    projects,
    projectPackages,
    packageStatus,
    sourcePdfPresign,
    sourcePdfConfirm,
    sourcePdfDownload,
    sourcePdfDelete,
    sourcePagePreview,
    workspace,
    logoPresign,
    logoConfirm,
  ] = await Promise.all([
    import('@/app/api/v1/auth/signup/route'),
    import('@/app/api/v1/projects/route'),
    import('@/app/api/v1/projects/[id]/packages/route'),
    import('@/app/api/v1/packages/[id]/status/route'),
    import('@/app/api/v1/packages/[id]/source-pdfs/presign/route'),
    import('@/app/api/v1/packages/[id]/source-pdfs/[sourcePdfId]/confirm/route'),
    import('@/app/api/v1/source-pdfs/[id]/download/route'),
    import('@/app/api/v1/source-pdfs/[id]/route'),
    import('@/app/api/v1/source-pages/[id]/preview/route'),
    import('@/app/api/v1/workspace/route'),
    import('@/app/api/v1/workspace/logo/presign/route'),
    import('@/app/api/v1/workspace/logo/confirm/route'),
  ]);

  return {
    signupPOST: signup.POST,
    projectsPOST: projects.POST,
    projectPackagesPOST: projectPackages.POST,
    packageStatusGET: packageStatus.GET,
    sourcePdfPresignPOST: sourcePdfPresign.POST,
    sourcePdfConfirmPOST: sourcePdfConfirm.POST,
    sourcePdfDownloadGET: sourcePdfDownload.GET,
    sourcePdfDELETE: sourcePdfDelete.DELETE,
    sourcePagePreviewGET: sourcePagePreview.GET,
    workspaceGET: workspace.GET,
    logoPresignPOST: logoPresign.POST,
    logoConfirmPOST: logoConfirm.POST,
  };
}

async function createAuthedUser(routes: Awaited<ReturnType<typeof loadRoutes>>, label: string) {
  const email = `phase3-${label}-${randomUUID()}@example.test`;
  const signup = await routes.signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: `Phase 3 ${label}`,
        workspace_name: `Phase 3 ${label} Workspace`,
        sub_company_name: `Phase 3 ${label} Sub`,
      }),
    }),
  );
  expect(signup.status).toBe(200);
  await flipEmailVerified(email);

  const signin = (await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  })) as Response;
  expect(signin.status).toBe(200);
  const jar = new CookieJar();
  jar.ingest(signin);

  const [user] = await db
    .select({ workspaceId: schema.users.workspaceId })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  expect(user).toBeDefined();

  return { email, cookie: jar.header(), workspaceId: user!.workspaceId };
}

async function createPackage(routes: Awaited<ReturnType<typeof loadRoutes>>, cookie: string) {
  const projectRes = await routes.projectsPOST(
    jsonReq('/api/v1/projects', cookie, {
      name: `Phase 3 Project ${randomUUID()}`,
      project_number: 'P-300',
      gc_name: 'Gilbane',
      architect_name: 'Gensler',
    }),
  );
  expect(projectRes.status).toBe(201);
  const project = (await projectRes.json()) as { id: string };

  const packageRes = await routes.projectPackagesPOST(
    jsonReq(`/api/v1/projects/${project.id}/packages`, cookie, {
      submittal_number: '23 81 00-001',
      spec_section: '23 81 00',
      title: 'VRF Equipment',
    }),
    ctx({ projectId: project.id }),
  );
  expect(packageRes.status).toBe(201);
  return (await packageRes.json()) as { id: string };
}

describe('Phase 3 file handling', () => {
  const emails: string[] = [];

  beforeEach(() => {
    storage.objects.clear();
    storage.deletedKeys.length = 0;
  });

  afterEach(async () => {
    vi.doUnmock('@/server/storage');
    while (emails.length > 0) {
      const email = emails.pop();
      if (email) await deleteUserByEmail(email);
    }
  });

  it('presigns, confirms, parses, previews, downloads, and deletes a source PDF', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'source-pdf');
    emails.push(user.email);
    const pkg = await createPackage(routes, user.cookie);

    const presign = await routes.sourcePdfPresignPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/source-pdfs/presign`, user.cookie, {
        filename: 'daikin.pdf',
        byte_size: 123,
        content_type: 'application/pdf',
      }),
      ctx({ id: pkg.id }),
    );
    expect(presign.status).toBe(201);
    const presignBody = (await presign.json()) as {
      source_pdf_id: string;
      storage_key: string;
      upload_url: string;
      expires_at: string;
      required_headers: Record<string, string>;
    };
    expect(presignBody.storage_key).toBe(
      `workspaces/${user.workspaceId}/source_pdfs/${presignBody.source_pdf_id}.pdf`,
    );
    expect(presignBody.upload_url).toContain('ttl=900');
    expect(presignBody.required_headers['content-type']).toBe('application/pdf');
    expect(new Date(presignBody.expires_at).getTime()).toBeGreaterThan(Date.now());

    const pdfBytes = new Uint8Array(await readFile(FIXTURE_PDF));
    await storage.putObject({
      key: presignBody.storage_key,
      body: pdfBytes,
      contentType: 'application/pdf',
    });

    const confirm = await routes.sourcePdfConfirmPOST(
      jsonReq(
        `/api/v1/packages/${pkg.id}/source-pdfs/${presignBody.source_pdf_id}/confirm`,
        user.cookie,
        {},
      ),
      ctx({ id: pkg.id, sourcePdfId: presignBody.source_pdf_id }),
    );
    expect(confirm.status).toBe(200);
    const confirmed = (await confirm.json()) as {
      id: string;
      sha256: string;
      byte_size: number;
      page_count: number;
    };
    expect(confirmed.page_count).toBe(3);
    expect(confirmed.byte_size).toBe(pdfBytes.byteLength);
    expect(confirmed.sha256).toBe(createHash('sha256').update(pdfBytes).digest('hex'));

    const pages = await db
      .select()
      .from(schema.sourcePages)
      .where(eq(schema.sourcePages.sourcePdfId, presignBody.source_pdf_id));
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => page.hasOcr)).toBe(true);
    expect(pages.every((page) => (page.ocrText?.length ?? 0) >= 50)).toBe(true);

    const status = await routes.packageStatusGET(
      authedReq(`/api/v1/packages/${pkg.id}/status`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      status: 'draft',
      source_pdfs: [
        {
          id: presignBody.source_pdf_id,
          processing_status: 'uploaded',
          processing_error: null,
        },
      ],
      jobs_summary: { queued: 0, running: 0, failed: 0 },
    });

    const preview = await routes.sourcePagePreviewGET(
      authedReq(`/api/v1/source-pages/${pages[0]!.id}/preview`, user.cookie),
      ctx({ id: pages[0]!.id }),
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { image_url: string; ocr_text: string };
    expect(previewBody.image_url).toContain(
      `workspaces/${user.workspaceId}/page_previews/${pages[0]!.id}.webp`,
    );
    expect(previewBody.ocr_text.length).toBeGreaterThanOrEqual(50);

    const download = await routes.sourcePdfDownloadGET(
      authedReq(`/api/v1/source-pdfs/${presignBody.source_pdf_id}/download`, user.cookie),
      ctx({ id: presignBody.source_pdf_id }),
    );
    expect(download.status).toBe(200);
    await expect(download.json()).resolves.toEqual({
      url: `https://storage.test/get/${presignBody.storage_key}?ttl=300`,
    });
    expect(
      createHash('sha256')
        .update(await storage.getObjectBytes(presignBody.storage_key))
        .digest('hex'),
    ).toBe(confirmed.sha256);

    const deleted = await routes.sourcePdfDELETE(
      authedReq(`/api/v1/source-pdfs/${presignBody.source_pdf_id}`, user.cookie, {
        method: 'DELETE',
      }),
      ctx({ id: presignBody.source_pdf_id }),
    );
    expect(deleted.status).toBe(204);
    expect(storage.deletedKeys).toContain(presignBody.storage_key);
  });

  it('rejects duplicate source PDFs by sha256 within a package', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'duplicate-pdf');
    emails.push(user.email);
    const pkg = await createPackage(routes, user.cookie);
    const pdfBytes = new Uint8Array(await readFile(FIXTURE_PDF));

    async function presignAndUpload(filename: string) {
      const presign = await routes.sourcePdfPresignPOST(
        jsonReq(`/api/v1/packages/${pkg.id}/source-pdfs/presign`, user.cookie, {
          filename,
          byte_size: pdfBytes.byteLength,
          content_type: 'application/pdf',
        }),
        ctx({ id: pkg.id }),
      );
      expect(presign.status).toBe(201);
      const body = (await presign.json()) as { source_pdf_id: string; storage_key: string };
      await storage.putObject({
        key: body.storage_key,
        body: pdfBytes,
        contentType: 'application/pdf',
      });
      return body;
    }

    const first = await presignAndUpload('first.pdf');
    const firstConfirm = await routes.sourcePdfConfirmPOST(
      jsonReq(
        `/api/v1/packages/${pkg.id}/source-pdfs/${first.source_pdf_id}/confirm`,
        user.cookie,
        {},
      ),
      ctx({ id: pkg.id, sourcePdfId: first.source_pdf_id }),
    );
    expect(firstConfirm.status).toBe(200);

    const duplicate = await presignAndUpload('duplicate.pdf');
    const duplicateConfirm = await routes.sourcePdfConfirmPOST(
      jsonReq(
        `/api/v1/packages/${pkg.id}/source-pdfs/${duplicate.source_pdf_id}/confirm`,
        user.cookie,
        {},
      ),
      ctx({ id: pkg.id, sourcePdfId: duplicate.source_pdf_id }),
    );
    expect(duplicateConfirm.status).toBe(409);
    await expect(duplicateConfirm.json()).resolves.toMatchObject({
      error: {
        code: 'duplicate_source_pdf',
        details: { existing_source_pdf_id: first.source_pdf_id },
      },
    });
  });

  it('presigns and confirms the workspace logo, then returns a presigned logo URL', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'logo');
    emails.push(user.email);

    const presign = await routes.logoPresignPOST(
      jsonReq('/api/v1/workspace/logo/presign', user.cookie, {
        filename: 'logo.png',
        byte_size: 4,
        content_type: 'image/png',
      }),
    );
    expect(presign.status).toBe(201);
    const presignBody = (await presign.json()) as {
      storage_key: string;
      upload_url: string;
      required_headers: Record<string, string>;
    };
    expect(presignBody.storage_key).toMatch(`workspaces/${user.workspaceId}/logos/`);
    expect(presignBody.upload_url).toContain('ttl=900');
    expect(presignBody.required_headers['content-type']).toBe('image/png');

    await storage.putObject({
      key: presignBody.storage_key,
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: 'image/png',
    });

    const confirm = await routes.logoConfirmPOST(
      jsonReq('/api/v1/workspace/logo/confirm', user.cookie, {
        storage_key: presignBody.storage_key,
      }),
    );
    expect(confirm.status).toBe(200);
    // The confirm response itself must carry the presigned logo URL so the
    // client cache shows the logo immediately (regression: it returned null).
    const confirmBody = (await confirm.json()) as { sub_company_logo_url: string };
    expect(confirmBody.sub_company_logo_url).toBe(
      `https://storage.test/get/${presignBody.storage_key}?ttl=300`,
    );

    const workspace = await routes.workspaceGET(authedReq('/api/v1/workspace', user.cookie));
    expect(workspace.status).toBe(200);
    const body = (await workspace.json()) as { sub_company_logo_url: string };
    expect(body.sub_company_logo_url).toBe(
      `https://storage.test/get/${presignBody.storage_key}?ttl=300`,
    );
  });

  it('commits S3 CORS allowing direct browser PUTs from the web origin', async () => {
    const cors = JSON.parse(
      await readFile(path.resolve(process.cwd(), '..', '..', 'infra', 's3-cors.json'), 'utf8'),
    ) as Array<{
      AllowedHeaders: string[];
      AllowedMethods: string[];
      AllowedOrigins: string[];
    }>;

    expect(cors[0]?.AllowedOrigins).toContain('http://localhost:3000');
    expect(cors[0]?.AllowedOrigins).toContain('http://localhost:3100');
    expect(cors[0]?.AllowedMethods).toContain('PUT');
    expect(cors[0]?.AllowedHeaders).toContain('content-type');
    expect(cors[0]?.AllowedHeaders).toContain('x-amz-server-side-encryption');
  });
});
