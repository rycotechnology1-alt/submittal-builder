import { randomBytes } from 'node:crypto';

/** Generates a URL-safe temp password. 18 random bytes → 24 base64url chars,
 *  i.e. 144 bits of entropy — well above the 8-char minimum and trivially
 *  copy-pasteable.
 */
export function generateTempPassword(): string {
  return randomBytes(18).toString('base64url');
}
