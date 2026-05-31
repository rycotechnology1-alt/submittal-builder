import '@/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'saved-items-test-pass-1234';

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
  vi.doMock('@/server/storage', () => ({
    getStorage: () => storage,
  }));

  const [signup, projects, projectPackages, saveCommon, savedItems, importSaved, packageDelete] =
    await Promise.all([
      import('@/app/api/v1/auth/signup/route'),
      import('@/app/api/v1/projects/route'),
      import('@/app/api/v1/projects/[id]/packages/route'),
      import('@/app/api/v1/items/[id]/save-common/route'),
      import('@/app/api/v1/saved-items/route'),
      import('@/app/api/v1/packages/[id]/saved-items/route'),
      import('@/app/api/v1/packages/[id]/route'),
    ]);

  return {
    signupPOST: signup.POST,
    projectsPOST: projects.POST,
    projectPackagesPOST: projectPackages.POST,
    saveCommonPOST: saveCommon.POST,
    savedItemsGET: savedItems.GET,
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
