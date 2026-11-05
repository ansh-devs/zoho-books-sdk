/**
 * Error hierarchy for the SDK.
 *
 * Zoho Books returns a JSON envelope `{ code, message }` on every response.
 * `code === 0` means success; any other value is an application error, even
 * when the HTTP status is 200. Every failure surfaces as a subclass of
 * {@link ZohoBooksError} so callers can `instanceof`-check without parsing text.
 */

export interface ZohoErrorDetails {
  /** HTTP status code of the response (0 when no response was received). */
  status: number;
  /** Zoho application error code from the response body, if present. */
  code?: number | undefined;
  /** HTTP method of the failed request. */
  method?: string | undefined;
  /** Request path (relative to the Books API base, without query string). */
  path?: string | undefined;
  /** Raw parsed response body, when available. */
  body?: unknown;
  /** Response headers, when available. */
  headers?: Record<string, string> | undefined;
  /** Underlying error (network failure, JSON parse failure, ...). */
  cause?: unknown;
}

export class ZohoBooksError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly body: unknown;
  readonly headers: Record<string, string> | undefined;

  constructor(message: string, details: ZohoErrorDetails) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = new.target.name;
    this.status = details.status;
    this.code = details.code;
    this.method = details.method;
    this.path = details.path;
    this.body = details.body;
    this.headers = details.headers;
  }

  /** Whether retrying the same request may succeed. */
  get retryable(): boolean {
    return false;
  }
}

/** 400 or a non-zero Zoho code that indicates invalid input. */
export class ZohoValidationError extends ZohoBooksError {}

/** 401: access token invalid/expired and could not be refreshed. */
export class ZohoAuthenticationError extends ZohoBooksError {}

/** 403: the token lacks the scope, or the user lacks the permission. */
export class ZohoPermissionError extends ZohoBooksError {}

/** 404: resource or URL not found. */
export class ZohoNotFoundError extends ZohoBooksError {}

/** 405 / 415 and other request-shape errors. */
export class ZohoRequestError extends ZohoBooksError {}

/**
 * Which Zoho limit was hit:
 * - `minute`: 100 requests/minute/org (code 44) — wait for the window to roll.
 * - `daily`: plan's daily quota (code 45) — NOT retryable until the next day.
 * - `concurrency`: too many in-flight requests (code 1070) — retry shortly.
 */
export type RateLimitKind = 'minute' | 'daily' | 'concurrency' | 'unknown';

/** 429: per-minute, daily or concurrency limit exceeded. */
export class ZohoRateLimitError extends ZohoBooksError {
  /** Milliseconds the server asked us to wait, if it said so. */
  readonly retryAfterMs: number | undefined;
  readonly kind: RateLimitKind;

  constructor(message: string, details: ZohoErrorDetails & { retryAfterMs?: number | undefined }) {
    super(message, details);
    this.retryAfterMs = details.retryAfterMs;
    this.kind =
      details.code === 44 ? 'minute' : details.code === 45 ? 'daily' : details.code === 1070 ? 'concurrency' : 'unknown';
  }

  override get retryable(): boolean {
    return this.kind !== 'daily';
  }
}

/** 5xx from Zoho. */
export class ZohoServerError extends ZohoBooksError {
  override get retryable(): boolean {
    return true;
  }
}

/** No HTTP response: DNS, TCP reset, TLS, etc. */
export class ZohoNetworkError extends ZohoBooksError {
  override get retryable(): boolean {
    return true;
  }
}

/** The request exceeded the configured timeout. */
export class ZohoTimeoutError extends ZohoBooksError {
  override get retryable(): boolean {
    return true;
  }
}

/** OAuth token endpoint failures (invalid_code, invalid_client, ...). */
export class ZohoOAuthError extends ZohoBooksError {
  /** The OAuth `error` value, e.g. `invalid_code`. */
  readonly oauthError: string | undefined;

  constructor(message: string, details: ZohoErrorDetails & { oauthError?: string | undefined }) {
    super(message, details);
    this.oauthError = details.oauthError;
  }
}

/** Local GST validation failure (bad GSTIN, missing tax, HSN...) — no request was sent. */
export class ZohoGstError extends ZohoValidationError {
  readonly field: string | undefined;
  constructor(message: string, field?: string) {
    super(message, { status: 0 });
    this.field = field;
  }
}

/** SDK misconfiguration detected before any request was made. */
export class ZohoConfigError extends ZohoBooksError {
  constructor(message: string) {
    super(message, { status: 0 });
  }
}

/**
 * Documented Zoho codes for rate limiting (returned with HTTP 429):
 * 44 = per-minute, 45 = daily quota, 1070 = concurrency.
 */
const RATE_LIMIT_CODES = new Set([44, 45, 1070]);

/** Documented "record does not exist" code (e.g. "Invoice does not exist"). */
const NOT_FOUND_CODES = new Set([1002]);

export function errorFromResponse(details: ZohoErrorDetails & { retryAfterMs?: number | undefined }): ZohoBooksError {
  const { status, code } = details;
  const zohoMessage =
    details.body && typeof details.body === 'object' && 'message' in details.body
      ? String((details.body as { message: unknown }).message)
      : undefined;
  const where = details.method && details.path ? ` (${details.method} ${details.path})` : '';
  const message = `${zohoMessage ?? `HTTP ${status}`}${code !== undefined ? ` [code ${code}]` : ''}${where}`;

  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    return new ZohoRateLimitError(message, details);
  }
  if (status === 401) return new ZohoAuthenticationError(message, details);
  if (status === 403) return new ZohoPermissionError(message, details);
  if (status === 404 || (code !== undefined && NOT_FOUND_CODES.has(code))) {
    return new ZohoNotFoundError(message, details);
  }
  if (status === 405 || status === 415) return new ZohoRequestError(message, details);
  if (status >= 500) return new ZohoServerError(message, details);
  return new ZohoValidationError(message, details);
}
