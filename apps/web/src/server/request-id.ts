import { randomUUID } from 'node:crypto';

const MAX_LEN = 128;

/**
 * Resolve the per-request correlation id. Respects an inbound `x-request-id`
 * header (so an upstream proxy can supply one) and falls back to a fresh UUID.
 * Phase 6 propagates this through enqueued pg-boss jobs into worker logs.
 */
export function requestIdFrom(headers: Headers): string {
  const existing = headers.get('x-request-id');
  if (existing) {
    const trimmed = existing.trim();
    if (trimmed.length > 0 && trimmed.length <= MAX_LEN) return trimmed;
  }
  return randomUUID();
}
