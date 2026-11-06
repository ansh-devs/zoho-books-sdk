import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header Zoho Books uses for the webhook signature. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-zoho-webhook-signature';

type Params = URLSearchParams | Record<string, string | string[] | undefined> | undefined;

export interface WebhookSignatureInput {
  /** Secret set on the webhook in Zoho Books. */
  secret: string;
  /** Decoded query parameters of the request. */
  query?: Params;
  /** Decoded form fields, for form encoded payloads. */
  form?: Params;
  /** Raw JSON body exactly as received. */
  rawBody?: string | Uint8Array;
}

function toPairs(p: Params): Array<[string, string]> {
  if (!p) return [];
  if (p instanceof URLSearchParams) return [...p.entries()];
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) out.push([k, item]);
  }
  return out;
}

/** Base64 HMAC SHA256 of the query and form pairs sorted by key and joined without separators, then the raw body. */
export function computeWebhookSignature(input: WebhookSignatureInput): string {
  const pairs = [...toPairs(input.query), ...toPairs(input.form)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const hmac = createHmac('sha256', input.secret);
  hmac.update(pairs.map(([k, v]) => k + v).join(''), 'utf8');
  if (input.rawBody !== undefined) {
    hmac.update(typeof input.rawBody === 'string' ? Buffer.from(input.rawBody, 'utf8') : input.rawBody);
  }
  return hmac.digest('base64');
}

/** Verify the signature Zoho sends in the X Zoho Webhook Signature header, in constant time. */
export function verifyWebhookSignature(input: WebhookSignatureInput & { signature: string | null | undefined }): boolean {
  if (!input.signature) return false;
  const expected = Buffer.from(computeWebhookSignature(input), 'utf8');
  const actual = Buffer.from(input.signature.trim(), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
