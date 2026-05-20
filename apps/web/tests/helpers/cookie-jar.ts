// Bare-bones cookie jar: collects Set-Cookie headers off responses and
// produces a Cookie header for subsequent requests. Sufficient for the
// signup→sign-in→/me→sign-out flow; not a general-purpose RFC 6265 impl.

export class CookieJar {
  private store = new Map<string, string>();

  ingest(res: Response): void {
    // Headers#getSetCookie exists in Node 20+.
    const cookies = res.headers.getSetCookie?.() ?? [];
    for (const raw of cookies) {
      const [pair] = raw.split(';');
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      if (value === '' || value === 'deleted') {
        this.store.delete(name);
      } else {
        this.store.set(name, value);
      }
    }
  }

  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.store.clear();
  }
}
