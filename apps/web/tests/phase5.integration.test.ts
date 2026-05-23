import '@/env';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { POST as signupPOST } from '@/app/api/v1/auth/signup/route';
import { POST as projectsPOST } from '@/app/api/v1/projects/route';
import { POST as projectPackagesPOST } from '@/app/api/v1/projects/[id]/packages/route';
import { GET as packageGET } from '@/app/api/v1/packages/[id]/route';
import { PATCH as itemPATCH } from '@/app/api/v1/items/[id]/route';
import { PUT as attributePUT } from '@/app/api/v1/items/[id]/attributes/[key]/route';
import { POST as attributeRevertPOST } from '@/app/api/v1/items/[id]/attributes/[key]/revert/route';
import { POST as reorderPOST } from '@/app/api/v1/packages/[id]/items/reorder/route';
import { PATCH as sourcePdfPATCH } from '@/app/api/v1/source-pdfs/[id]/route';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'phase-5-test-pass-1234';

type RouteContext<T extends Record<string, string>> = { params: Promise<T> };

function ctx<T extends Record<string, string>>(params: T): RouteContext<T> {
  return { params: Promise.resolve(params) };
}

function fakeReq(pathname: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${pathname}`, init);
}

function jsonReq(pathname: string, cookie: string, body: unknown = {}, method = 'POST'): Request {
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

async function loadExportsRoutes() {
  vi.resetModules();
  const queueCalls: { name: string; data: Record<string, unknown> }[] = [];
  vi.doMock('@/server/processing-queue', () => ({
    getProcessingQueue: () => ({
      send: async (name: string, data: Record<string, unknown>) => {
        queueCalls.push({ name, data });
        return `job-${queueCalls.length}`;
      },
    }),
  }));
  const route = await import('@/app/api/v1/packages/[id]/exports/route');
  return { ...route, queueCalls };
}

async function createAuthedUser(label: string) {
  const email = `phase5-${label}-${randomUUID()}@example.test`;
  await signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: `Phase 5 ${label}`,
        workspace_name: `Phase 5 ${label} WS`,
        sub_company_name: `Phase 5 ${label} Sub`,
      }),
    }),
  );
  await flipEmailVerified(email);

  const signin = (await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    asResponse: true,
  })) as Response;
  expect(signin.status).toBe(200);
  const jar = new CookieJar();
  jar.ingest(signin);

  const [user] = await db
    .select({ workspaceId: schema.users.workspaceId, id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  return { email, cookie: jar.header(), workspaceId: user!.workspaceId, userId: user!.id };
}

async function createReadyPackageWithItem(input: {
  workspaceId: string;
  userId: string;
  cookie: string;
}) {
  const projectRes = await projectsPOST(
    jsonReq('/api/v1/projects', input.cookie, {
      name: `Phase 5 Project ${randomUUID()}`,
    }),
  );
  const project = (await projectRes.json()) as { id: string };

  const pkgRes = await projectPackagesPOST(
    jsonReq(`/api/v1/projects/${project.id}/packages`, input.cookie, {
      submittal_number: '23 81 00-005',
      spec_section: '23 81 00',
      title: 'Phase 5 Package',
    }),
    ctx({ projectId: project.id }),
  );
  const pkg = (await pkgRes.json()) as { id: string };

  await db.update(schema.packages).set({ status: 'ready' }).where(eq(schema.packages.id, pkg.id));

  const [item] = await db
    .insert(schema.items)
    .values({
      workspaceId: input.workspaceId,
      packageId: pkg.id,
      docType: 'product_data',
      docTypeConfidence: 0.95,
      title: 'Daikin VRV',
      sortOrder: 0,
    })
    .returning();
  await db.insert(schema.itemAttributes).values({
    itemId: item!.id,
    key: 'manufacturer',
    currentValue: 'Daikin',
    originalAiValue: 'Daikin',
    confidence: 0.97,
  });

  return { project, pkg, item: item! };
}

describe('Phase 5 audit-aware item APIs', () => {
  const emails: string[] = [];

  afterEach(async () => {
    vi.doUnmock('@/server/processing-queue');
    while (emails.length > 0) {
      const email = emails.pop();
      if (email) await deleteUserByEmail(email);
    }
  });

  it('PUT attribute sets current_value, stamps edited_by_user_at, preserves original_ai_value', async () => {
    const user = await createAuthedUser('attr-edit');
    emails.push(user.email);
    const { item } = await createReadyPackageWithItem(user);

    const res = await attributePUT(
      jsonReq(`/api/v1/items/${item.id}/attributes/manufacturer`, user.cookie, { value: 'Mitsubishi' }, 'PUT'),
      ctx({ id: item.id, key: 'manufacturer' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.current_value).toBe('Mitsubishi');
    expect(body.original_ai_value).toBe('Daikin');
    expect(body.edited_by_user_at).not.toBeNull();
  });

  it('revert clears current_value to original_ai_value and unsets edited_by_user_at', async () => {
    const user = await createAuthedUser('attr-revert');
    emails.push(user.email);
    const { item } = await createReadyPackageWithItem(user);

    await attributePUT(
      jsonReq(`/api/v1/items/${item.id}/attributes/manufacturer`, user.cookie, { value: 'Mitsubishi' }, 'PUT'),
      ctx({ id: item.id, key: 'manufacturer' }),
    );

    const res = await attributeRevertPOST(
      jsonReq(`/api/v1/items/${item.id}/attributes/manufacturer/revert`, user.cookie, {}),
      ctx({ id: item.id, key: 'manufacturer' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.current_value).toBe('Daikin');
    expect(body.edited_by_user_at).toBeNull();
  });

  it('PATCH /items/:id preserves doc_type_original_ai_value on first doc_type change only', async () => {
    const user = await createAuthedUser('doctype');
    emails.push(user.email);
    const { item } = await createReadyPackageWithItem(user);

    const first = await itemPATCH(
      jsonReq(`/api/v1/items/${item.id}`, user.cookie, { doc_type: 'warranty' }, 'PATCH'),
      ctx({ id: item.id }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody.doc_type).toBe('warranty');
    expect(firstBody.doc_type_original_ai_value).toBe('product_data');

    const second = await itemPATCH(
      jsonReq(`/api/v1/items/${item.id}`, user.cookie, { doc_type: 'sds' }, 'PATCH'),
      ctx({ id: item.id }),
    );
    const secondBody = (await second.json()) as Record<string, unknown>;
    expect(secondBody.doc_type).toBe('sds');
    expect(secondBody.doc_type_original_ai_value).toBe('product_data');
  });

  it('item mutation endpoints accept edits on exported packages so users can add and adjust items post-export', async () => {
    const user = await createAuthedUser('locked');
    emails.push(user.email);
    const { pkg, item } = await createReadyPackageWithItem(user);
    await db.update(schema.packages).set({ status: 'exported' }).where(eq(schema.packages.id, pkg.id));

    const editRes = await itemPATCH(
      jsonReq(`/api/v1/items/${item.id}`, user.cookie, { title: 'New' }, 'PATCH'),
      ctx({ id: item.id }),
    );
    expect(editRes.status).toBe(200);

    const attrRes = await attributePUT(
      jsonReq(`/api/v1/items/${item.id}/attributes/manufacturer`, user.cookie, { value: 'x' }, 'PUT'),
      ctx({ id: item.id, key: 'manufacturer' }),
    );
    expect(attrRes.status).toBe(200);

    const revertRes = await attributeRevertPOST(
      jsonReq(`/api/v1/items/${item.id}/attributes/manufacturer/revert`, user.cookie, {}),
      ctx({ id: item.id, key: 'manufacturer' }),
    );
    expect(revertRes.status).toBe(200);

    const reorderRes = await reorderPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/items/reorder`, user.cookie, {
        order: [{ item_id: item.id, sort_order: 0 }],
      }),
      ctx({ id: pkg.id }),
    );
    expect(reorderRes.status).toBe(200);
  });

  it('PATCH /source-pdfs/:id reassigns within the same package; cross-package rejected', async () => {
    const user = await createAuthedUser('reassign');
    emails.push(user.email);
    const { pkg, item } = await createReadyPackageWithItem(user);

    const [otherItem] = await db
      .insert(schema.items)
      .values({
        workspaceId: user.workspaceId,
        packageId: pkg.id,
        docType: 'warranty',
        title: 'Other',
        sortOrder: 1,
      })
      .returning();

    const [sourcePdf] = await db
      .insert(schema.sourcePdfs)
      .values({
        workspaceId: user.workspaceId,
        packageId: pkg.id,
        storageKey: `workspaces/${user.workspaceId}/source_pdfs/${randomUUID()}.pdf`,
        originalFilename: 'thing.pdf',
        byteSize: 100,
        sha256: randomUUID().replaceAll('-', ''),
        pageCount: 1,
        processingStatus: 'extracted',
        itemId: item.id,
      })
      .returning();

    const res = await sourcePdfPATCH(
      jsonReq(`/api/v1/source-pdfs/${sourcePdf!.id}`, user.cookie, { item_id: otherItem!.id }, 'PATCH'),
      ctx({ id: sourcePdf!.id }),
    );
    expect(res.status).toBe(200);
    const [updated] = await db
      .select({ itemId: schema.sourcePdfs.itemId })
      .from(schema.sourcePdfs)
      .where(eq(schema.sourcePdfs.id, sourcePdf!.id));
    expect(updated!.itemId).toBe(otherItem!.id);

    // Cross-package target rejected with 409.
    const otherUser = await createAuthedUser('reassign-other');
    emails.push(otherUser.email);
    const otherPkg = await createReadyPackageWithItem(otherUser);
    const crossRes = await sourcePdfPATCH(
      jsonReq(`/api/v1/source-pdfs/${sourcePdf!.id}`, user.cookie, { item_id: otherPkg.item.id }, 'PATCH'),
      ctx({ id: sourcePdf!.id }),
    );
    expect(crossRes.status).toBe(409);
  });

  it('POST /packages/:id/exports enqueues render_export and inserts a pending row', async () => {
    const user = await createAuthedUser('export');
    emails.push(user.email);
    const { pkg } = await createReadyPackageWithItem(user);

    const { POST: exportsPOST, queueCalls } = await loadExportsRoutes();
    const res = await exportsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/exports`, user.cookie, { bates_prefix: 'SUB-' }),
      ctx({ id: pkg.id }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { export_id: string };
    expect(body.export_id).toMatch(/^[0-9a-f-]{36}$/);

    expect(queueCalls).toHaveLength(1);
    expect(queueCalls[0]!.name).toBe('render_export');
    expect(queueCalls[0]!.data).toMatchObject({ packageId: pkg.id, exportId: body.export_id });

    const [row] = await db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.id, body.export_id));
    expect(row).toMatchObject({
      packageId: pkg.id,
      status: 'pending',
      batesPrefix: 'SUB-',
    });
  });

  it('POST /packages/:id/exports rejects when package is still in draft/processing', async () => {
    const user = await createAuthedUser('export-not-ready');
    emails.push(user.email);
    const { pkg } = await createReadyPackageWithItem(user);
    await db.update(schema.packages).set({ status: 'draft' }).where(eq(schema.packages.id, pkg.id));

    const { POST: exportsPOST } = await loadExportsRoutes();
    const res = await exportsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/exports`, user.cookie, {}),
      ctx({ id: pkg.id }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'package_not_ready' } });
  });

  it('GET /packages/:id includes latest_export summary when an export exists', async () => {
    const user = await createAuthedUser('latest-export');
    emails.push(user.email);
    const { pkg } = await createReadyPackageWithItem(user);

    const [exportRow] = await db
      .insert(schema.exports)
      .values({
        packageId: pkg.id,
        createdByUserId: user.userId,
        storageKey: `workspaces/${user.workspaceId}/exports/${randomUUID()}.pdf`,
        status: 'ready',
        pageCount: 42,
        byteSize: 1024,
      })
      .returning();

    const res = await packageGET(
      authedReq(`/api/v1/packages/${pkg.id}`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { latest_export: Record<string, unknown> | null };
    expect(body.latest_export).toMatchObject({
      id: exportRow!.id,
      status: 'ready',
      byte_size: 1024,
      page_count: 42,
    });
  });

  it('POST /packages/:id/exports allows re-export after the package was already exported', async () => {
    const user = await createAuthedUser('re-export');
    emails.push(user.email);
    const { pkg } = await createReadyPackageWithItem(user);
    await db.update(schema.packages).set({ status: 'exported' }).where(eq(schema.packages.id, pkg.id));

    const { POST: exportsPOST } = await loadExportsRoutes();
    const res = await exportsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/exports`, user.cookie, {}),
      ctx({ id: pkg.id }),
    );
    expect(res.status).toBe(202);
  });

  it('PATCH /source-pdfs/:id allows reassignment on exported packages', async () => {
    const user = await createAuthedUser('reassign-locked');
    emails.push(user.email);
    const { pkg, item } = await createReadyPackageWithItem(user);
    const [sourcePdf] = await db
      .insert(schema.sourcePdfs)
      .values({
        workspaceId: user.workspaceId,
        packageId: pkg.id,
        storageKey: `workspaces/${user.workspaceId}/source_pdfs/${randomUUID()}.pdf`,
        originalFilename: 'locked.pdf',
        byteSize: 100,
        sha256: randomUUID().replaceAll('-', ''),
        pageCount: 1,
        processingStatus: 'extracted',
        itemId: item.id,
      })
      .returning();

    await db.update(schema.packages).set({ status: 'exported' }).where(eq(schema.packages.id, pkg.id));

    const res = await sourcePdfPATCH(
      jsonReq(`/api/v1/source-pdfs/${sourcePdf!.id}`, user.cookie, { item_id: null }, 'PATCH'),
      ctx({ id: sourcePdf!.id }),
    );
    expect(res.status).toBe(200);
  });
});
