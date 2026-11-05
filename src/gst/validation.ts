import { stateFromGstin, type IndianState } from './states.js';

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Compute the GSTIN check character for the first 14 characters
 * (mod-36 Luhn variant used by GSTN).
 */
export function gstinChecksum(first14: string): string {
  const s = first14.toUpperCase();
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(s[i]!);
    if (value < 0) throw new TypeError(`Invalid GSTIN character "${s[i]}"`);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36]!;
}

export interface GstinInfo {
  valid: boolean;
  /** Normalised (trimmed, upper-case) GSTIN. */
  gstin: string;
  reason?: string;
  state?: IndianState;
  /** Embedded PAN for regular taxpayers. */
  pan?: string;
  /** `regular` (PAN-based), `tds` (TAN-based deductor), or `other` (UN body, NRTP, OIDAR...). */
  kind?: 'regular' | 'tds' | 'other';
}

const GSTIN_SHAPE = /^[0-9]{2}[0-9A-Z]{10}[0-9A-Z]{3}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN = /^[A-Z]{4}[0-9]{5}[A-Z]$/;

/** Parse and validate a GSTIN: format, state code and checksum. */
export function parseGstin(input: string): GstinInfo {
  const gstin = (input ?? '').trim().toUpperCase();
  if (gstin.length !== 15) return { valid: false, gstin, reason: 'GSTIN must be 15 characters' };
  if (!GSTIN_SHAPE.test(gstin)) return { valid: false, gstin, reason: 'GSTIN has invalid characters' };

  const state = stateFromGstin(gstin);
  // 99 = Centre jurisdiction / OIDAR, still a valid GSTN prefix.
  if (!state && gstin.slice(0, 2) !== '99') return { valid: false, gstin, reason: `Unknown state code ${gstin.slice(0, 2)}` };

  const expected = gstinChecksum(gstin.slice(0, 14));
  if (expected !== gstin[14]) return { valid: false, gstin, reason: `Checksum mismatch (expected ${expected})`, ...(state ? { state } : {}) };

  const body = gstin.slice(2, 12);
  const kind: GstinInfo['kind'] = PAN.test(body) ? 'regular' : TAN.test(body) ? 'tds' : 'other';
  return { valid: true, gstin, kind, ...(state ? { state } : {}), ...(kind === 'regular' ? { pan: body } : {}) };
}

export function isValidGstin(input: string): boolean {
  return parseGstin(input).valid;
}

export interface HsnSacInfo {
  valid: boolean;
  code: string;
  kind?: 'hsn' | 'sac';
  reason?: string;
}

/**
 * Validate an HSN (goods: 4/6/8 digits) or SAC (services: 6 digits starting
 * with `99`). Pass `minDigits` to enforce the turnover-based minimum
 * (4 digits up to ₹5 Cr AATO, 6 digits above; 8 for exports/e-invoices is common).
 */
export function validateHsnOrSac(input: string | number, options: { minDigits?: 4 | 6 | 8 } = {}): HsnSacInfo {
  const code = String(input ?? '').trim();
  if (!/^\d+$/.test(code)) return { valid: false, code, reason: 'HSN/SAC must contain digits only' };
  const isSac = code.startsWith('99') && code.length === 6;
  if (!isSac && ![4, 6, 8].includes(code.length)) {
    return { valid: false, code, reason: 'HSN must be 4, 6 or 8 digits; SAC must be 6 digits starting with 99' };
  }
  if (options.minDigits && code.length < options.minDigits) {
    return { valid: false, code, kind: isSac ? 'sac' : 'hsn', reason: `At least ${options.minDigits} digits required` };
  }
  return { valid: true, code, kind: isSac ? 'sac' : 'hsn' };
}
