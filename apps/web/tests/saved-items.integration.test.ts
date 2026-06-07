import '@/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'saved-items-test-pass-1234';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePdfPath = path.join(__dirname, '__fixtures__', '01-daikin-vrv-cutsheet.pdf');

type RouteContext<T extends Record<string, string>> = { params: Promise<T> };

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
  const queuedJobs: { name: string; data: object; options: object }[] = [];
  vi.doMock('@/server/storage', () => ({
    getStorage: () => storage,
  }));
  vi.doMock('@/server/processing-queue', () => ({
    getProcessingQueue: () => ({
      send: async (name: string, data: object, options: object) => {
        queuedJobs.push({ name, data, options });
        return `job-${queuedJobs.length}`;
      },
    }),
  }));

  const [
    signup,
    projects,
    projectPackages,
    saveCommon,
    savedItems,
    savedItemDetail,
    savedItemAttribute,
    savedItemVariants,
    savedItemVariant,
    savedItemUploadPresign,
    savedItemUploadConfirm,
    importSaved,
    packageDelete,
  ] = await Promise.all([
    import('@/app/api/v1/auth/signup/route'),
    import('@/app/api/v1/projects/route'),
    import('@/app/api/v1/projects/[id]/packages/route'),
    import('@/app/api/v1/items/[id]/save-common/route'),
    import('@/app/api/v1/saved-items/route'),
    import('@/app/api/v1/saved-items/[id]/route'),
    import('@/app/api/v1/saved-items/[id]/attributes/[key]/route'),
    import('@/app/api/v1/saved-items/[id]/variants/route'),
    import('@/app/api/v1/saved-items/[id]/variants/[variantId]/route'),
    import('@/app/api/v1/saved-items/uploads/presign/route'),
    import('@/app/api/v1/saved-items/uploads/confirm/route'),
    import('@/app/api/v1/packages/[id]/saved-items/route'),
    import('@/app/api/v1/packages/[id]/route'),
  ]);

  return {
    queuedJobs,
    signupPOST: signup.POST,
    projectsPOST: projects.POST,
    projectPackagesPOST: projectPackages.POST,
    saveCommonPOST: saveCommon.POST,
    savedItemsGET: savedItems.GET,
    savedItemGET: savedItemDetail.GET,
    savedItemPATCH: savedItemDetail.PATCH,
    savedItemDELETE: savedItemDetail.DELETE,
    savedItemAttributePUT: savedItemAttribute.PUT,
    savedItemVariantsPOST: savedItemVariants.POST,
    savedItemVariantPATCH: savedItemVariant.PATCH,
    savedItemVariantDELETE: savedItemVariant.DELETE,
    savedItemUploadPresignPOST: savedItemUploadPresign.POST,
    savedItemUploadConfirmPOST: savedItemUploadConfirm.POST,
    importSavedPOST: importSaved.POST,
    packageDELETE: packageDelete.DELETE,
  };
}

async function createAuthedUser(routes: Awaited<ReturnType<typeof loadRoutes>>, label: string) {
  const email = `saved-items-${label}-${randomUUID()}@example.test`;
  const signup = await routes.signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: `Saved Items ${label}`,
        workspace_name: `Saved Items ${label} Workspace`,
        sub_company_name: `Saved Items ${label} Sub`,
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
    .select({ id: schema.users.id, workspaceId: schema.users.workspaceId })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  expect(user).toBeDefined();

  return { email, cookie: jar.header(), userId: user!.id, workspaceId: user!.workspaceId };
}

async function createPackage(routes: Awaited<ReturnType<typeof loadRoutes>>, cookie: string) {
  const projectRes = await routes.projectsPOST(
    jsonReq('/api/v1/projects', cookie, {
      name: `Saved Items Project ${randomUUID()}`,
      project_number: 'P-SAVED',
      gc_name: 'Gilbane',
      architect_name: 'Gensler',
    }),
  );
  expect(projectRes.status).toBe(201);
  const project = (await projectRes.json()) as { id: string };

  const packageRes = await routes.projectPackagesPOST(
    jsonReq(`/api/v1/projects/${project.id}/packages`, cookie, {
      submittal_number: '26 05 33-001',
      spec_section: '26 05 33',
      title: 'Raceways',
    }),
    ctx({ projectId: project.id }),
  );
  expect(packageRes.status).toBe(201);
  return (await packageRes.json()) as { id: string };
}

async function seedProcessedItem(input: { workspaceId: string; packageId: string }) {
  const [item] = await db
    .insert(schema.items)
    .values({
      workspaceId: input.workspaceId,
      packageId: input.packageId,
      title: 'PVC conduit cutsheet',
      docType: 'product_data',
      docTypeConfidence: 0.94,
      docTypeOriginalAiValue: 'product_data',
      sortOrder: 0,
    })
    .returning();
  const storageKey = `workspaces/${input.workspaceId}/source_pdfs/${randomUUID()}.pdf`;
  const sha256 = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  await storage.putObject({
    key: storageKey,
    body: new Uint8Array([1, 2, 3, 4]),
    contentType: 'application/pdf',
  });
  const [sourcePdf] = await db
    .insert(schema.sourcePdfs)
    .values({
      workspaceId: input.workspaceId,
      packageId: input.packageId,
      storageKey,
      originalFilename: 'pvc-conduit.pdf',
      byteSize: 4,
      sha256,
      pageCount: 2,
      processingStatus: 'extracted',
      itemId: item!.id,
    })
    .returning();
  const pages = await db
    .insert(schema.sourcePages)
    .values([
      { sourcePdfId: sourcePdf!.id, pageNumber: 1, hasOcr: true, ocrText: 'PVC conduit table' },
      { sourcePdfId: sourcePdf!.id, pageNumber: 2, hasOcr: true, ocrText: 'PVC conduit notes' },
    ])
    .returning();
  await db.insert(schema.itemAttributes).values([
    {
      itemId: item!.id,
      key: 'manufacturer',
      currentValue: 'Cantex',
      originalAiValue: 'Cantex',
      confidence: 0.91,
      sourcePageId: pages[0]!.id,
    },
    {
      itemId: item!.id,
      key: 'model_number',
      currentValue: 'PVC-BASE',
      originalAiValue: 'PVC-BASE',
      confidence: 0.88,
      sourcePageId: pages[0]!.id,
    },
  ]);
  await db.insert(schema.itemVariants).values([
    {
      itemId: item!.id,
      sourcePageId: pages[0]!.id,
      partNumber: 'PV050',
      size: '1/2 in',
      displayLabel: '1/2 in',
      sortOrder: 0,
      isDefaultForSize: true,
      selectedAt: new Date(),
      partNumberVerification: 'found',
    },
    {
      itemId: item!.id,
      sourcePageId: pages[0]!.id,
      partNumber: 'PV075',
      size: '3/4 in',
      displayLabel: '3/4 in',
      sortOrder: 1,
      isDefaultForSize: true,
      selectedAt: null,
      partNumberVerification: 'found',
    },
  ]);
  return { item: item!, sourcePdf: sourcePdf!, pages, storageKey };
}

describe('saved common items', () => {
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

  it('saves extracted size options but not selected package sizes', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'save-options');
    emails.push(user.email);
    const pkg = await createPackage(routes, user.cookie);
    const { item } = await seedProcessedItem({
      workspaceId: user.workspaceId,
      packageId: pkg.id,
    });

    const saved = await routes.saveCommonPOST(
      jsonReq(`/api/v1/items/${item.id}/save-common`, user.cookie, {}),
      ctx({ id: item.id }),
    );
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { saved_item: { id: string }; created: boolean };
    expect(savedBody.created).toBe(true);

    const savedVariants = await db
      .select({
        partNumber: (schema as any).savedItemVariants.partNumber,
        size: (schema as any).savedItemVariants.size,
        sortOrder: (schema as any).savedItemVariants.sortOrder,
      })
      .from((schema as any).savedItemVariants)
      .where(eq((schema as any).savedItemVariants.savedItemId, savedBody.saved_item.id))
      .orderBy((schema as any).savedItemVariants.sortOrder);
    expect(savedVariants).toEqual([
      { partNumber: 'PV050', size: '1/2 in', sortOrder: 0 },
      { partNumber: 'PV075', size: '3/4 in', sortOrder: 1 },
    ]);

    const duplicate = await routes.saveCommonPOST(
      jsonReq(`/api/v1/items/${item.id}/save-common`, user.cookie, {}),
      ctx({ id: item.id }),
    );
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: 'saved_item_already_exists' },
    });

    const [fileCount] = await db
      .select({ value: count() })
      .from((schema as any).savedItemFiles)
      .where(eq((schema as any).savedItemFiles.workspaceId, user.workspaceId));
    expect(fileCount?.value).toBe(1);
  });

  it('loads, edits, and deletes saved items without leaking across workspaces', async () => {
    const routes = await loadRoutes();
    const owner = await createAuthedUser(routes, 'edit-owner');
    const intruder = await createAuthedUser(routes, 'edit-intruder');
    emails.push(owner.email, intruder.email);
    const pkg = await createPackage(routes, owner.cookie);
    const { item, storageKey } = await seedProcessedItem({
      workspaceId: owner.workspaceId,
      packageId: pkg.id,
    });

    const saved = await routes.saveCommonPOST(
      jsonReq(`/api/v1/items/${item.id}/save-common`, owner.cookie, {}),
      ctx({ id: item.id }),
    );
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { saved_item: { id: string } };
    const savedItemId = savedBody.saved_item.id;

    const detail = await routes.savedItemGET(
      authedReq(`/api/v1/saved-items/${savedItemId}`, owner.cookie),
      ctx({ id: savedItemId }),
    );
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.file).toMatchObject({
      original_filename: 'pvc-conduit.pdf',
      processing_status: 'extracted',
      processing_error: null,
    });
    expect(detailBody.source_pages).toHaveLength(2);
    expect(detailBody.attributes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'manufacturer' })]),
    );
    expect(detailBody.variants[0]).not.toHaveProperty('selected');
    expect(detailBody.variants[0]).not.toHaveProperty('selected_at');

    const patch = await routes.savedItemPATCH(
      jsonReq(
        `/api/v1/saved-items/${savedItemId}`,
        owner.cookie,
        { title: 'Edited conduit sheet', doc_type: 'installation' },
        'PATCH',
      ),
      ctx({ id: savedItemId }),
    );
    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      saved_item: { title: 'Edited conduit sheet', doc_type: 'installation' },
    });

    const attrEdit = await routes.savedItemAttributePUT(
      jsonReq(
        `/api/v1/saved-items/${savedItemId}/attributes/manufacturer`,
        owner.cookie,
        { value: 'Edited MFR' },
        'PUT',
      ),
      ctx({ id: savedItemId, key: 'manufacturer' }),
    );
    expect(attrEdit.status).toBe(200);
    const attrBody = await attrEdit.json();
    expect(attrBody.attribute.current_value).toBe('Edited MFR');
    expect(attrBody.attribute.edited_by_user_at).toEqual(expect.any(String));

    const addVariant = await routes.savedItemVariantsPOST(
      jsonReq(`/api/v1/saved-items/${savedItemId}/variants`, owner.cookie, {
        part_number: 'PV100',
        size: '1 in',
        secondary_dims: { packaging: 'Bundle' },
        display_label: '1 in - Bundle',
        sort_order: 2,
        is_default_for_size: true,
        saved_item_source_page_id: detailBody.source_pages[0].id,
      }),
      ctx({ id: savedItemId }),
    );
    expect(addVariant.status).toBe(201);
    const addVariantBody = await addVariant.json();
    expect(addVariantBody.variant).not.toHaveProperty('selected');

    const editVariant = await routes.savedItemVariantPATCH(
      jsonReq(
        `/api/v1/saved-items/${savedItemId}/variants/${addVariantBody.variant.id}`,
        owner.cookie,
        { display_label: '1 in conduit', sort_order: 3 },
        'PATCH',
      ),
      ctx({ id: savedItemId, variantId: addVariantBody.variant.id }),
    );
    expect(editVariant.status).toBe(200);
    await expect(editVariant.json()).resolves.toMatchObject({
      variant: { display_label: '1 in conduit', sort_order: 3 },
    });

    const deleteVariant = await routes.savedItemVariantDELETE(
      authedReq(
        `/api/v1/saved-items/${savedItemId}/variants/${addVariantBody.variant.id}`,
        owner.cookie,
        { method: 'DELETE' },
      ),
      ctx({ id: savedItemId, variantId: addVariantBody.variant.id }),
    );
    expect(deleteVariant.status).toBe(204);

    const intruderDetail = await routes.savedItemGET(
      authedReq(`/api/v1/saved-items/${savedItemId}`, intruder.cookie),
      ctx({ id: savedItemId }),
    );
    expect(intruderDetail.status).toBe(404);

    const deleted = await routes.savedItemDELETE(
      authedReq(`/api/v1/saved-items/${savedItemId}`, owner.cookie, { method: 'DELETE' }),
      ctx({ id: savedItemId }),
    );
    expect(deleted.status).toBe(204);
    expect(storage.deletedKeys).not.toContain(storageKey);
    const list = await routes.savedItemsGET(authedReq('/api/v1/saved-items', owner.cookie));
    expect(await list.json()).toMatchObject({ data: [] });
  });

  it('imports saved items as unselected package snapshots and keeps saved storage on delete', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'import-options');
    emails.push(user.email);
    const sourcePackage = await createPackage(routes, user.cookie);
    const targetPackage = await createPackage(routes, user.cookie);
    const { item, storageKey } = await seedProcessedItem({
      workspaceId: user.workspaceId,
      packageId: sourcePackage.id,
    });

    const saved = await routes.saveCommonPOST(
      jsonReq(`/api/v1/items/${item.id}/save-common`, user.cookie, {}),
      ctx({ id: item.id }),
    );
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { saved_item: { id: string } };

    const importRes = await routes.importSavedPOST(
      jsonReq(`/api/v1/packages/${targetPackage.id}/saved-items`, user.cookie, {
        saved_item_ids: [savedBody.saved_item.id],
      }),
      ctx({ id: targetPackage.id }),
    );
    expect(importRes.status).toBe(201);
    const importedBody = (await importRes.json()) as { imported_item_ids: string[] };
    expect(importedBody.imported_item_ids).toHaveLength(1);

    const importedVariants = await db
      .select({
        selectedAt: schema.itemVariants.selectedAt,
        size: schema.itemVariants.size,
      })
      .from(schema.itemVariants)
      .where(eq(schema.itemVariants.itemId, importedBody.imported_item_ids[0]!));
    expect(importedVariants).toHaveLength(2);
    expect(importedVariants.every((variant) => variant.selectedAt === null)).toBe(true);

    const [importedSource] = await db
      .select()
      .from(schema.sourcePdfs)
      .where(
        and(
          eq(schema.sourcePdfs.packageId, targetPackage.id),
          eq(schema.sourcePdfs.itemId, importedBody.imported_item_ids[0]!),
        ),
      )
      .limit(1);
    expect((importedSource as any).savedItemFileId).toBeTruthy();
    expect(importedSource!.storageKey).toBe(storageKey);

    const deleted = await routes.packageDELETE(
      authedReq(`/api/v1/packages/${targetPackage.id}`, user.cookie, { method: 'DELETE' }),
      ctx({ id: targetPackage.id }),
    );
    expect(deleted.status).toBe(204);
    expect(storage.deletedKeys).not.toContain(storageKey);
    expect(storage.objects.has(storageKey)).toBe(true);
  });

  it('deletes library rows safely when imported snapshots still reference saved storage', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'safe-delete');
    emails.push(user.email);
    const sourcePackage = await createPackage(routes, user.cookie);
    const targetPackage = await createPackage(routes, user.cookie);
    const { item, storageKey } = await seedProcessedItem({
      workspaceId: user.workspaceId,
      packageId: sourcePackage.id,
    });

    const saved = await routes.saveCommonPOST(
      jsonReq(`/api/v1/items/${item.id}/save-common`, user.cookie, {}),
      ctx({ id: item.id }),
    );
    const savedBody = (await saved.json()) as { saved_item: { id: string } };

    const imported = await routes.importSavedPOST(
      jsonReq(`/api/v1/packages/${targetPackage.id}/saved-items`, user.cookie, {
        saved_item_ids: [savedBody.saved_item.id],
      }),
      ctx({ id: targetPackage.id }),
    );
    expect(imported.status).toBe(201);

    const deleted = await routes.savedItemDELETE(
      authedReq(`/api/v1/saved-items/${savedBody.saved_item.id}`, user.cookie, {
        method: 'DELETE',
      }),
      ctx({ id: savedBody.saved_item.id }),
    );
    expect(deleted.status).toBe(204);
    expect(storage.deletedKeys).not.toContain(storageKey);
    expect(storage.objects.has(storageKey)).toBe(true);

    const fileRows = await db
      .select()
      .from(schema.savedItemFiles)
      .where(eq(schema.savedItemFiles.workspaceId, user.workspaceId));
    expect(fileRows).toHaveLength(1);
    const libraryRows = await db
      .select()
      .from(schema.savedItems)
      .where(eq(schema.savedItems.workspaceId, user.workspaceId));
    expect(libraryRows).toHaveLength(0);
  });

  it('directly uploads saved items, dedupes exact uploads, and blocks imports before extraction', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'upload');
    emails.push(user.email);
    const pkg = await createPackage(routes, user.cookie);
    const bytes = new Uint8Array(await readFile(fixturePdfPath));

    const presign = await routes.savedItemUploadPresignPOST(
      jsonReq('/api/v1/saved-items/uploads/presign', user.cookie, {
        filename: 'direct-daikin.pdf',
        byte_size: bytes.byteLength,
        content_type: 'application/pdf',
      }),
    );
    expect(presign.status).toBe(201);
    const presignBody = await presign.json();
    expect(presignBody.storage_key).toContain(`/saved_item_files/`);
    await storage.putObject({
      key: presignBody.storage_key,
      body: bytes,
      contentType: 'application/pdf',
    });

    const confirm = await routes.savedItemUploadConfirmPOST(
      jsonReq('/api/v1/saved-items/uploads/confirm', user.cookie, {
        storage_key: presignBody.storage_key,
        original_filename: 'direct-daikin.pdf',
      }),
    );
    expect(confirm.status).toBe(201);
    const confirmBody = await confirm.json();
    expect(confirmBody).toMatchObject({
      duplicate: false,
      processing_status: 'uploaded',
      saved_item: { original_filename: 'direct-daikin.pdf' },
    });
    expect(routes.queuedJobs).toEqual([
      expect.objectContaining({
        name: 'saved_item_process',
        data: expect.objectContaining({ savedItemId: confirmBody.saved_item.id }),
      }),
    ]);

    const importProcessing = await routes.importSavedPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/saved-items`, user.cookie, {
        saved_item_ids: [confirmBody.saved_item.id],
      }),
      ctx({ id: pkg.id }),
    );
    expect(importProcessing.status).toBe(409);
    await expect(importProcessing.json()).resolves.toMatchObject({
      error: { code: 'saved_item_not_ready' },
    });

    const duplicatePresign = await routes.savedItemUploadPresignPOST(
      jsonReq('/api/v1/saved-items/uploads/presign', user.cookie, {
        filename: 'direct-daikin-copy.pdf',
        byte_size: bytes.byteLength,
        content_type: 'application/pdf',
      }),
    );
    const duplicatePresignBody = await duplicatePresign.json();
    await storage.putObject({
      key: duplicatePresignBody.storage_key,
      body: bytes,
      contentType: 'application/pdf',
    });
    const duplicate = await routes.savedItemUploadConfirmPOST(
      jsonReq('/api/v1/saved-items/uploads/confirm', user.cookie, {
        storage_key: duplicatePresignBody.storage_key,
        original_filename: 'direct-daikin-copy.pdf',
      }),
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      duplicate: true,
      saved_item: { id: confirmBody.saved_item.id },
      processing_status: 'uploaded',
    });
    expect(storage.deletedKeys).toContain(duplicatePresignBody.storage_key);

    const deleted = await routes.savedItemDELETE(
      authedReq(`/api/v1/saved-items/${confirmBody.saved_item.id}`, user.cookie, {
        method: 'DELETE',
      }),
      ctx({ id: confirmBody.saved_item.id }),
    );
    expect(deleted.status).toBe(204);
    expect(storage.deletedKeys).toContain(presignBody.storage_key);
  });

  it('rejects cross-workspace saved item imports', async () => {
    const routes = await loadRoutes();
    const owner = await createAuthedUser(routes, 'owner');
    const intruder = await createAuthedUser(routes, 'intruder');
    emails.push(owner.email, intruder.email);
    const ownerPackage = await createPackage(routes, owner.cookie);
    const intruderPackage = await createPackage(routes, intruder.cookie);
    const { item } = await seedProcessedItem({
      workspaceId: owner.workspaceId,
      packageId: ownerPackage.id,
    });

    const saved = await routes.saveCommonPOST(
      jsonReq(`/api/v1/items/${item.id}/save-common`, owner.cookie, {}),
      ctx({ id: item.id }),
    );
    expect(saved.status).toBe(201);
    const savedBody = (await saved.json()) as { saved_item: { id: string } };

    const importRes = await routes.importSavedPOST(
      jsonReq(`/api/v1/packages/${intruderPackage.id}/saved-items`, intruder.cookie, {
        saved_item_ids: [savedBody.saved_item.id],
      }),
      ctx({ id: intruderPackage.id }),
    );
    expect(importRes.status).toBe(404);
  });
});
