import type { Env } from '../env';
import { ApiError } from './http';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  delivered: boolean;
  /** Development only: the outbox is logged so the flow can be completed locally. */
  devMode: boolean;
}

/**
 * Email delivery through Resend (free tier).
 * When no API key is configured the app refuses silently only in development, where the
 * message is written to the console instead. In production a missing key is an error so
 * that verification e-mails are never silently dropped.
 */
export async function sendEmail(env: Env, input: SendEmailInput): Promise<SendEmailResult> {
  const isProduction = env.ENV === 'production';
  if (!env.RESEND_API_KEY) {
    if (isProduction) {
      throw new ApiError(
        503,
        'email_not_configured',
        'سرویس ارسال ایمیل پیکربندی نشده است. با مدیر تماس بگیرید.',
      );
    }
    console.info(`\n[DEV OUTBOX] to: ${input.to}\nsubject: ${input.subject}\n${input.text}\n`);
    return { delivered: false, devMode: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? 'My Media Universe <onboarding@resend.dev>',
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('Resend delivery failed', response.status, detail);
    throw new ApiError(502, 'email_delivery_failed', 'ارسال ایمیل ناموفق بود. لطفاً کمی بعد دوباره تلاش کنید.');
  }
  return { delivered: true, devMode: false };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
