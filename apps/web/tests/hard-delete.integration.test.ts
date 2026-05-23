import '@/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'hard-delete-test-pass-1234';

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

  const [signup, projectDelete, packageDelete] = await Promise.all([
    import('@/app/api/v1/auth/signup/route'),
    import('@/app/api/v1/projects/[id]/route'),
    import('@/app/api/v1/packages/[id]/route'),
  ]);

  return {
    signupPOST: signup.POST,
    projectDELETE: projectDelete.DELETE,
    packageDELETE: packageDelete.DELETE,
  };
}

async function createAuthedUser(routes: Awaited<ReturnType<typeof loadRoutes>>, label: string) {
  const email = `hard-delete-${label}-${randomUUID()}@example.test`;
  const signup = await routes.signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: `Hard Delete ${label}`,
        workspace_name: `Hard Delete ${label} WS`,
        sub_company_name: `Hard Delete ${label} Sub`,
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
    .select({ workspaceId: schema.users.workspaceId, id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  return { email, cookie: jar.header(), workspaceId: user!.workspaceId, userId: user!.id };
}

async function seedProjectWithChildren(input: {
  workspaceId: string;
  userId: string;
  packageCount?: number;
}) {
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: input.workspaceId,
      name: `Project ${randomUUID()}`,
    })
    .returning();

  const packages: { id: string; sourcePdfKeys: string[]; exportKeys: string[] }[] = [];
  const count = input.packageCount ?? 1;
  for (let i = 0; i < count; i++) {
    const [pkg] = await db
      .insert(schema.packages)
      .values({
        workspaceId: input.workspaceId,
        projectId: project!.id,
        submittalNumber: `S-${i}-${randomUUID().slice(0, 6)}`,
        specSection: '23 81 00',
        title: `Pkg ${i}`,
      })
      .returning();

    const sourcePdfKeys: string[] = [];
    for (let p = 0; p < 2; p++) {
      const key = `workspaces/${input.workspaceId}/source_pdfs/${randomUUID()}.pdf`;
      sourcePdfKeys.push(key);
      const [sp] = await db
        .insert(schema.sourcePdfs)
        .values({
          workspaceId: input.workspaceId,
          packageId: pkg!.id,
          storageKey: key,
          originalFilename: `file-${p}.pdf`,
          byteSize: 100,
          sha256: randomUUID().replaceAll('-', ''),
          pageCount: 1,
          processingStatus: 'extracted',
        })
        .returning();
      await db.insert(schema.sourcePages).values({
        sourcePdfId: sp!.id,
        pageNumber: 1,
        hasOcr: true,
        ocrText: 'ocr text',
      });
    }

    const [item] = await db
      .insert(schema.items)
      .values({
        workspaceId: input.workspaceId,
        packageId: pkg!.id,
        docType: 'product_data',
        title: `Item ${i}`,
        sortOrder: 0,
      })
      .returning();
    await db.insert(schema.itemAttributes).values({
      itemId: item!.id,
      key: 'manufacturer',
      currentValue: 'Daikin',
      confidence: 0.9,
    });

    const exportKeys: string[] = [];
    for (let e = 0; e < 1; e++) {
      const key = `workspaces/${input.workspaceId}/exports/${randomUUID()}.pdf`;
      exportKeys.push(key);
      await db.insert(schema.exports).values({
        packageId: pkg!.id,
        createdByUserId: input.userId,
        storageKey: key,
        byteSize: 200,
        pageCount: 2,
        status: 'ready',
      });
    }

    await db.insert(schema.processingJobs).values({
      packageId: pkg!.id,
      kind: 'render_export',
      status: 'succeeded',
    });

    packages.push({ id: pkg!.id, sourcePdfKeys, exportKeys });
  }

  return { project: project!, packages };
}

describe('Cascading hard-delete', () => {
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

  it('DELETE package: removes row + descendants and best-effort deletes storage keys', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'pkg');
    emails.push(user.email);

    const { project, packages } = await seedProjectWithChildren({
      workspaceId: user.workspaceId,
      userId: user.userId,
      packageCount: 2,
    });
    const target = packages[0]!;
    const sibling = packages[1]!;
    const expectedKeys = new Set([...target.sourcePdfKeys, ...target.exportKeys]);

    const res = await routes.packageDELETE(
      authedReq(`/api/v1/packages/${target.id}`, user.cookie, { method: 'DELETE' }),
      ctx({ id: target.id }),
    );
    expect(res.status).toBe(204);

    // Target package and descendants gone.
    const targetRow = await db
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.id, target.id));
    expect(targetRow).toHaveLength(0);

    const targetItems = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.packageId, target.id));
    expect(targetItems).toHaveLength(0);

    const targetPdfs = await db
      .select()
      .from(schema.sourcePdfs)
      .where(eq(schema.sourcePdfs.packageId, target.id));
    expect(targetPdfs).toHaveLength(0);

    const targetExports = await db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.packageId, target.id));
    expect(targetExports).toHaveLength(0);

    const targetJobs = await db
      .select()
      .from(schema.processingJobs)
      .where(eq(schema.processingJobs.packageId, target.id));
    expect(targetJobs).toHaveLength(0);

    // Sibling package untouched.
    const siblingRow = await db
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.id, sibling.id));
    expect(siblingRow).toHaveLength(1);

    // Project untouched.
    const projectRow = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectRow).toHaveLength(1);

    // All target storage keys were deleted from storage.
    expect(new Set(storage.deletedKeys)).toEqual(expectedKeys);
  });

  it('DELETE project: cascades to all packages and removes every storage key', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'project');
    emails.push(user.email);

    const { project, packages } = await seedProjectWithChildren({
      workspaceId: user.workspaceId,
      userId: user.userId,
      packageCount: 2,
    });
    const expectedKeys = new Set(
      packages.flatMap((p) => [...p.sourcePdfKeys, ...p.exportKeys]),
    );

    const res = await routes.projectDELETE(
      authedReq(`/api/v1/projects/${project.id}`, user.cookie, { method: 'DELETE' }),
      ctx({ id: project.id }),
    );
    expect(res.status).toBe(204);

    const projectRow = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectRow).toHaveLength(0);

    for (const pkg of packages) {
      const pkgRow = await db
        .select()
        .from(schema.packages)
        .where(eq(schema.packages.id, pkg.id));
      expect(pkgRow).toHaveLength(0);

      const pdfs = await db
        .select()
        .from(schema.sourcePdfs)
        .where(eq(schema.sourcePdfs.packageId, pkg.id));
      expect(pdfs).toHaveLength(0);

      const exports = await db
        .select()
        .from(schema.exports)
        .where(eq(schema.exports.packageId, pkg.id));
      expect(exports).toHaveLength(0);
    }

    expect(new Set(storage.deletedKeys)).toEqual(expectedKeys);
  });

  it('DELETE package: purges already-soft-deleted package', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'soft-pkg');
    emails.push(user.email);

    const { packages } = await seedProjectWithChildren({
      workspaceId: user.workspaceId,
      userId: user.userId,
    });
    const target = packages[0]!;
    await db
      .update(schema.packages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.packages.id, target.id));

    const res = await routes.packageDELETE(
      authedReq(`/api/v1/packages/${target.id}`, user.cookie, { method: 'DELETE' }),
      ctx({ id: target.id }),
    );
    expect(res.status).toBe(204);

    const row = await db
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.id, target.id));
    expect(row).toHaveLength(0);
    expect(new Set(storage.deletedKeys)).toEqual(
      new Set([...target.sourcePdfKeys, ...target.exportKeys]),
    );
  });

  it('DELETE project: purges already-soft-deleted project', async () => {
    const routes = await loadRoutes();
    const user = await createAuthedUser(routes, 'soft-project');
    emails.push(user.email);

    const { project, packages } = await seedProjectWithChildren({
      workspaceId: user.workspaceId,
      userId: user.userId,
    });
    await db
      .update(schema.projects)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projects.id, project.id));

    const res = await routes.projectDELETE(
      authedReq(`/api/v1/projects/${project.id}`, user.cookie, { method: 'DELETE' }),
      ctx({ id: project.id }),
    );
    expect(res.status).toBe(204);

    const row = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(row).toHaveLength(0);
    expect(new Set(storage.deletedKeys)).toEqual(
      new Set(packages.flatMap((p) => [...p.sourcePdfKeys, ...p.exportKeys])),
    );
  });

  it('DELETE package: returns 404 for cross-workspace request', async () => {
    const routes = await loadRoutes();
    const owner = await createAuthedUser(routes, 'pkg-owner');
    emails.push(owner.email);
    const intruder = await createAuthedUser(routes, 'pkg-intruder');
    emails.push(intruder.email);

    const { packages } = await seedProjectWithChildren({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
    });
    const target = packages[0]!;

    const res = await routes.packageDELETE(
      authedReq(`/api/v1/packages/${target.id}`, intruder.cookie, { method: 'DELETE' }),
      ctx({ id: target.id }),
    );
    expect(res.status).toBe(404);

    const row = await db
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.id, target.id));
    expect(row).toHaveLength(1);
    expect(storage.deletedKeys).toHaveLength(0);
  });

  it('DELETE project: returns 404 for cross-workspace request', async () => {
    const routes = await loadRoutes();
    const owner = await createAuthedUser(routes, 'project-owner');
    emails.push(owner.email);
    const intruder = await createAuthedUser(routes, 'project-intruder');
    emails.push(intruder.email);

    const { project } = await seedProjectWithChildren({
      workspaceId: owner.workspaceId,
      userId: owner.userId,
    });

    const res = await routes.projectDELETE(
      authedReq(`/api/v1/projects/${project.id}`, intruder.cookie, { method: 'DELETE' }),
      ctx({ id: project.id }),
    );
    expect(res.status).toBe(404);

    const row = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(row).toHaveLength(1);
    expect(storage.deletedKeys).toHaveLength(0);
  });
});
