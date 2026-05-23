// Phase 2 integration tests for workspace/project/package/item CRUD.
// These call App Router route handlers directly and hit the live Neon dev DB.

import '@/env';
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { POST as signupPOST } from '@/app/api/v1/auth/signup/route';
import { GET as workspaceGET, PATCH as workspacePATCH } from '@/app/api/v1/workspace/route';
import { GET as projectsGET, POST as projectsPOST } from '@/app/api/v1/projects/route';
import {
  DELETE as projectDELETE,
  GET as projectGET,
  PATCH as projectPATCH,
} from '@/app/api/v1/projects/[id]/route';
import {
  GET as projectPackagesGET,
  POST as projectPackagesPOST,
} from '@/app/api/v1/projects/[id]/packages/route';
import {
  DELETE as packageDELETE,
  GET as packageGET,
  PATCH as packagePATCH,
} from '@/app/api/v1/packages/[id]/route';
import { GET as packageStatusGET } from '@/app/api/v1/packages/[id]/status/route';
import {
  GET as packageItemsGET,
  POST as packageItemsPOST,
} from '@/app/api/v1/packages/[id]/items/route';
import { POST as packageItemsReorderPOST } from '@/app/api/v1/packages/[id]/items/reorder/route';
import {
  DELETE as itemDELETE,
  PATCH as itemPATCH,
} from '@/app/api/v1/items/[id]/route';
import { auth } from '@/server/auth';
import { db, schema } from '@/server/db';

import { CookieJar } from './helpers/cookie-jar';
import { deleteUserByEmail } from './helpers/test-db';

const PASSWORD = 'phase-2-test-pass-1234';

type AuthedUser = {
  email: string;
  cookie: string;
  workspaceId: string;
};

type RouteContext<T extends Record<string, string>> = {
  params: Promise<T>;
};

function ctx<T extends Record<string, string>>(params: T): RouteContext<T> {
  return { params: Promise.resolve(params) };
}

function fakeReq(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

function jsonReq(path: string, cookie: string, body: unknown, method = 'POST'): Request {
  return fakeReq(path, {
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

function authedReq(path: string, cookie: string, init?: RequestInit): Request {
  return fakeReq(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), cookie, origin: 'http://localhost:3000' },
  });
}

async function flipEmailVerified(email: string): Promise<void> {
  await db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.email, email));
}

async function createAuthedUser(label: string): Promise<AuthedUser> {
  const email = `phase2-${label}-${randomUUID()}@example.test`;
  const signup = await signupPOST(
    fakeReq('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({
        email,
        password: PASSWORD,
        name: `Phase 2 ${label}`,
        workspace_name: `Phase 2 ${label} Workspace`,
        sub_company_name: `Phase 2 ${label} Sub`,
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

async function createProject(cookie: string, name = `Project ${randomUUID()}`) {
  const res = await projectsPOST(
    jsonReq('/api/v1/projects', cookie, {
      name,
      project_number: 'P-100',
      gc_name: 'Turner',
      architect_name: 'SOM',
    }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

async function createPackage(cookie: string, projectId: string, title = 'Acoustical Ceilings') {
  const res = await projectPackagesPOST(
    jsonReq(`/api/v1/projects/${projectId}/packages`, cookie, {
      submittal_number: '09 51 13-001',
      spec_section: '09 51 13',
      submittal_date: '2026-05-20',
      title,
    }),
    ctx({ projectId }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; revision: string; status: string };
}

describe('Phase 2 workspace/project/package/item CRUD', () => {
  const emails: string[] = [];

  afterEach(async () => {
    while (emails.length > 0) {
      const email = emails.pop();
      if (email) await deleteUserByEmail(email);
    }
  });

  it('gets and patches the current workspace', async () => {
    const user = await createAuthedUser('workspace');
    emails.push(user.email);

    const before = await workspaceGET(authedReq('/api/v1/workspace', user.cookie));
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as { sub_company_logo_url: string | null };
    expect(beforeBody.sub_company_logo_url).toBeNull();

    const patch = await workspacePATCH(
      jsonReq('/api/v1/workspace', user.cookie, {
        name: 'Updated Workspace',
        sub_company_name: 'Updated Sub',
      }, 'PATCH'),
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as { name: string; sub_company_name: string };
    expect(body.name).toBe('Updated Workspace');
    expect(body.sub_company_name).toBe('Updated Sub');
  });

  it('validates project payloads and invalid UUID path params', async () => {
    const user = await createAuthedUser('validation');
    emails.push(user.email);

    const malformed = await projectsPOST(jsonReq('/api/v1/projects', user.cookie, { name: '' }));
    expect(malformed.status).toBe(422);
    const malformedBody = (await malformed.json()) as { error: { code: string } };
    expect(malformedBody.error.code).toBe('validation_failed');

    const invalidId = await projectGET(
      authedReq('/api/v1/projects/not-a-uuid', user.cookie),
      ctx({ id: 'not-a-uuid' }),
    );
    expect(invalidId.status).toBe(404);
  });

  it('creates, lists, updates, and hard-deletes projects', async () => {
    const user = await createAuthedUser('projects');
    emails.push(user.email);

    const project = await createProject(user.cookie, 'Library Renovation');

    const list = await projectsGET(authedReq('/api/v1/projects?q=library', user.cookie));
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { data: Array<{ id: string }>; next_cursor: null };
    expect(listBody.next_cursor).toBeNull();
    expect(listBody.data.map((p) => p.id)).toContain(project.id);

    const patch = await projectPATCH(
      jsonReq(`/api/v1/projects/${project.id}`, user.cookie, { gc_name: 'Skanska' }, 'PATCH'),
      ctx({ id: project.id }),
    );
    expect(patch.status).toBe(200);
    const patchBody = (await patch.json()) as { gc_name: string };
    expect(patchBody.gc_name).toBe('Skanska');

    const deleted = await projectDELETE(
      authedReq(`/api/v1/projects/${project.id}`, user.cookie, { method: 'DELETE' }),
      ctx({ id: project.id }),
    );
    expect(deleted.status).toBe(204);

    const after = await projectsGET(authedReq('/api/v1/projects?q=library', user.cookie));
    const afterBody = (await after.json()) as { data: Array<{ id: string }> };
    expect(afterBody.data.map((p) => p.id)).not.toContain(project.id);
  });

  it('cascades package deletion when the parent project is hard-deleted', async () => {
    const user = await createAuthedUser('packages');
    emails.push(user.email);
    const project = await createProject(user.cookie, 'Tower');
    const pkg = await createPackage(user.cookie, project.id);

    const detail = await packageGET(
      authedReq(`/api/v1/packages/${pkg.id}`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      source_pdf_count: number;
      item_count: number;
      latest_export: null;
    };
    expect(detailBody.source_pdf_count).toBe(0);
    expect(detailBody.item_count).toBe(0);
    expect(detailBody.latest_export).toBeNull();

    const status = await packageStatusGET(
      authedReq(`/api/v1/packages/${pkg.id}/status`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      status: 'draft',
      source_pdfs: [],
      jobs_summary: { queued: 0, running: 0, failed: 0 },
    });

    await projectDELETE(
      authedReq(`/api/v1/projects/${project.id}`, user.cookie, { method: 'DELETE' }),
      ctx({ id: project.id }),
    );

    const orphanedPackages = await projectPackagesGET(
      authedReq(`/api/v1/projects/${project.id}/packages`, user.cookie),
      ctx({ projectId: project.id }),
    );
    expect(orphanedPackages.status).toBe(404);

    const pkgRow = await db
      .select()
      .from(schema.packages)
      .where(eq(schema.packages.id, pkg.id));
    expect(pkgRow).toHaveLength(0);
  });

  it('creates manual items with attributes, lists them, patches and reorders them', async () => {
    const user = await createAuthedUser('items');
    emails.push(user.email);
    const project = await createProject(user.cookie, 'School');
    const pkg = await createPackage(user.cookie, project.id);

    const first = await packageItemsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/items`, user.cookie, {
        source_pdf_ids: [],
        doc_type: 'product_data',
        title: 'Ceiling Tile',
        attributes: {
          manufacturer: 'Armstrong',
          model_number: 'Ultima 1912',
          description: 'Acoustical ceiling tile',
          spec_section_ref: '09 51 13',
        },
      }),
      ctx({ id: pkg.id }),
    );
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { item: { id: string } };

    const [attr] = await db
      .select({
        currentValue: schema.itemAttributes.currentValue,
        originalAiValue: schema.itemAttributes.originalAiValue,
        editedByUserAt: schema.itemAttributes.editedByUserAt,
      })
      .from(schema.itemAttributes)
      .where(eq(schema.itemAttributes.itemId, firstBody.item.id))
      .limit(1);
    expect(attr?.currentValue).toBeTruthy();
    expect(attr?.originalAiValue).toBeNull();
    expect(attr?.editedByUserAt).toBeNull();

    const second = await packageItemsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/items`, user.cookie, {
        source_pdf_ids: [],
        doc_type: 'warranty',
        title: 'Warranty',
      }),
      ctx({ id: pkg.id }),
    );
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { item: { id: string } };

    const patched = await itemPATCH(
      jsonReq(`/api/v1/items/${firstBody.item.id}`, user.cookie, { sort_order: 10 }, 'PATCH'),
      ctx({ id: firstBody.item.id }),
    );
    expect(patched.status).toBe(200);

    const reordered = await packageItemsReorderPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/items/reorder`, user.cookie, {
        order: [
          { item_id: secondBody.item.id, sort_order: 0 },
          { item_id: firstBody.item.id, sort_order: 1 },
        ],
      }),
      ctx({ id: pkg.id }),
    );
    expect(reordered.status).toBe(200);

    const list = await packageItemsGET(
      authedReq(`/api/v1/packages/${pkg.id}/items`, user.cookie),
      ctx({ id: pkg.id }),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as Array<{ item: { id: string }; attributes: unknown[] }>;
    expect(listBody.map((row) => row.item.id)).toEqual([secondBody.item.id, firstBody.item.id]);
    expect(listBody[1]?.attributes).toHaveLength(4);
  });

  it('returns 404 for cross-workspace project, package, item, and reorder access', async () => {
    const owner = await createAuthedUser('owner');
    const outsider = await createAuthedUser('outsider');
    emails.push(owner.email, outsider.email);
    const project = await createProject(owner.cookie, 'Private Project');
    const pkg = await createPackage(owner.cookie, project.id);
    const itemRes = await packageItemsPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/items`, owner.cookie, {
        source_pdf_ids: [],
        doc_type: 'other',
        title: 'Private Item',
      }),
      ctx({ id: pkg.id }),
    );
    const item = (await itemRes.json()) as { item: { id: string } };

    const foreignProject = await projectGET(
      authedReq(`/api/v1/projects/${project.id}`, outsider.cookie),
      ctx({ id: project.id }),
    );
    expect(foreignProject.status).toBe(404);

    const foreignPackage = await packagePATCH(
      jsonReq(`/api/v1/packages/${pkg.id}`, outsider.cookie, { title: 'Nope' }, 'PATCH'),
      ctx({ id: pkg.id }),
    );
    expect(foreignPackage.status).toBe(404);

    const foreignItem = await itemDELETE(
      authedReq(`/api/v1/items/${item.item.id}`, outsider.cookie, { method: 'DELETE' }),
      ctx({ id: item.item.id }),
    );
    expect(foreignItem.status).toBe(404);

    const badReorder = await packageItemsReorderPOST(
      jsonReq(`/api/v1/packages/${pkg.id}/items/reorder`, owner.cookie, {
        order: [{ item_id: randomUUID(), sort_order: 0 }],
      }),
      ctx({ id: pkg.id }),
    );
    expect(badReorder.status).toBe(404);
  });
});
