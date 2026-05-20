// Resend wrapper used by better-auth's email-verification + password-reset
// hooks (apps/web/src/server/auth.ts). Plain-text templates per the Phase 1
// brief — HTML is a Phase 6+ polish concern.
//
// Lazy-instantiated so importing this module doesn't require RESEND_API_KEY
// to be set (e.g. during typecheck in CI without secrets).

import { Resend } from 'resend';

let cached: Resend | null = null;

function client(): Resend {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error('RESEND_API_KEY is not set');
  }
  cached = new Resend(key);
  return cached;
}

function from(): string {
  const addr = process.env.EMAIL_FROM;
  if (!addr) throw new Error('EMAIL_FROM is not set');
  const name = process.env.EMAIL_FROM_NAME ?? 'Submittal Builder';
  return `${name} <${addr}>`;
}

export type EmailDeliveryResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendVerificationEmail(args: {
  to: string;
  name: string;
  verificationUrl: string;
}): Promise<EmailDeliveryResult> {
  const { to, name, verificationUrl } = args;
  const subject = 'Confirm your Submittal Builder email';
  const text = [
    `Hi ${name || 'there'},`,
    '',
    'Welcome to Submittal Builder. Confirm your email address to finish setting up your account:',
    '',
    verificationUrl,
    '',
    'This link expires in 1 hour. If you did not sign up, you can ignore this email.',
  ].join('\n');

  try {
    const res = await client().emails.send({ from: from(), to, subject, text });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, id: res.data?.id ?? '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendPasswordResetEmail(args: {
  to: string;
  name: string;
  resetUrl: string;
}): Promise<EmailDeliveryResult> {
  const { to, name, resetUrl } = args;
  const subject = 'Reset your Submittal Builder password';
  const text = [
    `Hi ${name || 'there'},`,
    '',
    'We received a request to reset your password. Click below to choose a new one:',
    '',
    resetUrl,
    '',
    'This link expires in 1 hour. If you did not request a reset, you can ignore this email.',
  ].join('\n');

  try {
    const res = await client().emails.send({ from: from(), to, subject, text });
    if (res.error) return { ok: false, error: res.error.message };
    return { ok: true, id: res.data?.id ?? '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
