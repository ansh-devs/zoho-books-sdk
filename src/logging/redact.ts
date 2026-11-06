/** What to hide in log fields. Secrets are always hidden; PII masking can be turned off. */
export interface RedactOptions {
  /** Mask GSTIN, PAN, email and phone values. Default true. */
  pii?: boolean;
  /** Extra field names to hide completely, matched without regard to case. */
  keys?: string[];
}

export const REDACTED = '[REDACTED]';

/** Field names whose values are credentials. Always hidden, cannot be turned off. */
const SECRET_KEY = /authorization|token|secret|password|cookie|api_?key|refresh_?token|client_?secret/i;

/** Field names holding personal or tax identifiers, masked by default. */
const PII_KEYS = new Set([
  'gst_no',
  'gstin',
  'shipping_gst_no',
  'pan',
  'email',
  'to_mail_ids',
  'cc_mail_ids',
  'bcc_mail_ids',
  'phone',
  'mobile',
  'tax_reg_no',
  'vat_reg_no',
]);

const MAX_DEPTH = 8;

/** Keep the first and last two characters, e.g. 27AAPFU0939F1ZV becomes 27***ZV. */
export function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValue);
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const s = String(value);
  return s.length <= 4 ? '***' : `${s.slice(0, 2)}***${s.slice(-2)}`;
}

/** Copy of value with secrets hidden and PII masked. Never mutates the input. */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const extra = new Set((options.keys ?? []).map((k) => k.toLowerCase()));
  const pii = options.pii !== false;
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof Date) return v.toISOString();
    if (seen.has(v)) return '[Circular]';
    if (depth >= MAX_DEPTH) return '[Truncated]';
    seen.add(v);
    if (Array.isArray(v)) return v.map((item) => walk(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(v)) {
      const lower = key.toLowerCase();
      if (SECRET_KEY.test(key) || extra.has(lower)) out[key] = REDACTED;
      else if (pii && PII_KEYS.has(lower)) out[key] = maskValue(val);
      else out[key] = walk(val, depth + 1);
    }
    return out;
  };
  return walk(value, 0);
}

/** JSON text of a body, redacted and cut to maxLength characters. */
export function bodyPreview(body: unknown, options: RedactOptions, maxLength: number): unknown {
  if (body === undefined) return undefined;
  const safe = redact(body, options);
  let text: string;
  try {
    text = typeof safe === 'string' ? safe : JSON.stringify(safe);
  } catch {
    return '[Unserializable]';
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(${text.length - maxLength} more)` : safe;
}
