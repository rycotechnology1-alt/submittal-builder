import { NextResponse } from 'next/server';
import { z } from 'zod';

export type RouteContext<T extends Record<string, string>> = {
  params: Promise<T> | T;
};

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status },
  );
}

export function validationError(error: z.ZodError) {
  return jsonError(422, 'validation_failed', 'Invalid request payload', error.flatten());
}

export async function parseJson<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'bad_request', 'Body must be valid JSON');
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  return parsed.data;
}

export function parseUuid(value: string | undefined): string | Response {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) return jsonError(404, 'not_found', 'Not found');
  return parsed.data;
}

export async function uuidParam<T extends Record<string, string>, K extends keyof T & string>(
  context: RouteContext<T>,
  key: K,
): Promise<string | Response> {
  const params = await context.params;
  return parseUuid(params[key]);
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
