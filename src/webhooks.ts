import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header Zoho Books uses for the webhook signature. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-zoho-webhook-signature';

type Params = URLSearchParams | Record<string, string | string[] | undefined> | undefined;

export interface WebhookSignatureInput {
  /** The secret configured on the webhook in Zoho Books. */
  secret: string;
  /** Query parameters of the incoming request (URL-decoded). */
  query?: Params;
  /** Form fields for `x-www-form-urlencoded` payloads (URL-decoded). */
  form?: Params;
  /** The raw JSON body exactly as received (for JSON payloads). */
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

/**
 * Compute the expected signature:
 * `base64(HMAC-SHA256(secret, sortedKeyValuePairs + rawJsonBody))`, where the
 * query and form parameters are sorted by key and concatenated as
 * `key + value` without separators.
 */
export function computeWebhookSignature(input: WebhookSignatureInput): string {
  const pairs = [...toPairs(input.query), ...toPairs(input.form)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const hmac = createHmac('sha256', input.secret);
  hmac.update(pairs.map(([k, v]) => k + v).join(''), 'utf8');
  if (input.rawBody !== undefined) {
    hmac.update(typeof input.rawBody === 'string' ? Buffer.from(input.rawBody, 'utf8') : input.rawBody);
  }
  return hmac.digest('base64');
}

/**
 * Verify a Zoho Books webhook signature in constant time.
 *
 * ```ts
 * app.post('/zoho/webhook', express.raw({ type: '*\/*' }), (req, res) => {
 *   const ok = verifyWebhookSignature({
 *     secret: process.env.ZOHO_WEBHOOK_SECRET!,
 *     signature: req.header('x-zoho-webhook-signature'),
 *     query: req.query as Record<string, string>,
 *     rawBody: req.body,
 *   });
 *   if (!ok) return res.sendStatus(401);
 *   res.sendStatus(200); // ack fast — Zoho times out after 10 s and retries
 * });
 * ```
 */
export function verifyWebhookSignature(input: WebhookSignatureInput & { signature: string | null | undefined }): boolean {
  if (!input.signature) return false;
  const expected = Buffer.from(computeWebhookSignature(input), 'utf8');
  const actual = Buffer.from(input.signature.trim(), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
