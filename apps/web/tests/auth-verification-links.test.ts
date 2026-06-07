import { describe, expect, it } from 'vitest';

import {
  buildEmailVerificationProxyUrl,
  toEmailClientSafeVerificationUrl,
} from '@/server/auth-verification-links';

describe('email verification links', () => {
  it('rewrites Better Auth verification URLs to avoid a token query parameter in the email', () => {
    const jwt = 'header.payload.signature';
    const url =
      'https://example.com/api/v1/auth/verify-email?token=' +
      jwt +
      '&callbackURL=%2F';

    const rewritten = toEmailClientSafeVerificationUrl(url);
    const parsed = new URL(rewritten);

    expect(parsed.pathname).toBe('/api/v1/auth/verify-email-link');
    expect(parsed.searchParams.get('t')).toBe(jwt);
    expect(parsed.searchParams.get('callbackURL')).toBe('/');
    expect(parsed.searchParams.has('token')).toBe(false);
  });

  it('reconstructs the Better Auth verification URL internally from the email-safe URL', () => {
    const jwt = 'header.payload.signature';
    const proxyUrl = buildEmailVerificationProxyUrl(
      `https://example.com/api/v1/auth/verify-email-link?t=${jwt}&callbackURL=%2F`,
    );

    expect(proxyUrl?.toString()).toBe(
      `https://example.com/api/v1/auth/verify-email?token=${jwt}&callbackURL=%2F`,
    );
  });
});
