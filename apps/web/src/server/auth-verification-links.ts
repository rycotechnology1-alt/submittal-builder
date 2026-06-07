export function toEmailClientSafeVerificationUrl(url: string): string {
  const parsed = new URL(url);
  const token = parsed.searchParams.get('token');
  if (!token || !parsed.pathname.endsWith('/verify-email')) {
    return url;
  }

  parsed.pathname = parsed.pathname.replace(/\/verify-email$/, '/verify-email-link');
  parsed.searchParams.delete('token');
  parsed.searchParams.set('t', token);
  return parsed.toString();
}

export function buildEmailVerificationProxyUrl(url: string): URL | null {
  const parsed = new URL(url);
  const token = parsed.searchParams.get('t');
  if (!token) return null;

  const proxyUrl = new URL('/api/v1/auth/verify-email', parsed.origin);
  proxyUrl.searchParams.set('token', token);

  const callbackURL = parsed.searchParams.get('callbackURL');
  if (callbackURL) {
    proxyUrl.searchParams.set('callbackURL', callbackURL);
  }

  return proxyUrl;
}
