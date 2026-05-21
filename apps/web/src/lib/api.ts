// Typed fetch wrapper for /api/v1/*. Same-origin, credentials included so
// better-auth's session cookie rides along. Throws ApiError on non-2xx with
// the structured error envelope from step-5; reads x-request-id for
// correlation across the backend + worker.

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  requestId: string | null;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId: string | null;
  }) {
    super(args.message);
    this.name = 'ApiError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.requestId = args.requestId;
  }
}

type ApiInit = Omit<RequestInit, 'body'> & { json?: unknown };

async function request<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(path.startsWith('/') ? path : `/${path}`, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : (rest as RequestInit).body,
  });

  const requestId = res.headers.get('x-request-id');

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // non-JSON error response
    }
    throw new ApiError({
      status: res.status,
      code: body?.error?.code ?? 'http_error',
      message: body?.error?.message ?? `Request failed (${res.status})`,
      details: body?.error?.details,
      requestId,
    });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, init?: ApiInit) => request<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, json?: unknown, init?: ApiInit) =>
    request<T>(path, { ...init, method: 'POST', json }),
  patch: <T>(path: string, json?: unknown, init?: ApiInit) =>
    request<T>(path, { ...init, method: 'PATCH', json }),
  put: <T>(path: string, json?: unknown, init?: ApiInit) =>
    request<T>(path, { ...init, method: 'PUT', json }),
  delete: <T>(path: string, init?: ApiInit) =>
    request<T>(path, { ...init, method: 'DELETE' }),
};
