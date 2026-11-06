/** Fields every SDK error carries. */
export interface ZohoErrorDetails {
  /** HTTP status, or 0 when no response arrived. */
  status: number;
  /** Zoho application code from the response body. */
  code?: number | undefined;
  method?: string | undefined;
  /** Request path relative to the Books API base. */
  path?: string | undefined;
  /** Parsed response body. */
  body?: unknown;
  headers?: Record<string, string> | undefined;
  /** Underlying error such as a network failure. */
  cause?: unknown;
}

/** Base class for every error the SDK throws. */
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

  /** True when repeating the same request may succeed. */
  get retryable(): boolean {
    return false;
  }
}

/** HTTP 400, or a non zero Zoho code. */
export class ZohoValidationError extends ZohoBooksError {}

/** HTTP 401 that persisted after one token refresh. */
export class ZohoAuthenticationError extends ZohoBooksError {}

/** HTTP 403, usually a missing scope. */
export class ZohoPermissionError extends ZohoBooksError {}

/** HTTP 404, or Zoho code 1002. */
export class ZohoNotFoundError extends ZohoBooksError {}

/** HTTP 405 or 415. */
export class ZohoRequestError extends ZohoBooksError {}

/** Which Zoho limit was hit: code 44 is per minute, 45 is the daily quota, 1070 is concurrency. */
export type RateLimitKind = 'minute' | 'daily' | 'concurrency' | 'unknown';

/** HTTP 429. The daily quota is not retryable. */
export class ZohoRateLimitError extends ZohoBooksError {
  /** Wait the server asked for, in ms. */
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

/** HTTP 5xx. */
export class ZohoServerError extends ZohoBooksError {
  override get retryable(): boolean {
    return true;
  }
}

/** No response arrived. */
export class ZohoNetworkError extends ZohoBooksError {
  override get retryable(): boolean {
    return true;
  }
}

/** The request exceeded its timeout. */
export class ZohoTimeoutError extends ZohoBooksError {
  override get retryable(): boolean {
    return true;
  }
}

/** The OAuth token endpoint refused the request. */
export class ZohoOAuthError extends ZohoBooksError {
  /** OAuth error value such as invalid_code. */
  readonly oauthError: string | undefined;

  constructor(message: string, details: ZohoErrorDetails & { oauthError?: string | undefined }) {
    super(message, details);
    this.oauthError = details.oauthError;
  }
}

/** Local GST validation failed. No request was sent. */
export class ZohoGstError extends ZohoValidationError {
  readonly field: string | undefined;
  constructor(message: string, field?: string) {
    super(message, { status: 0 });
    this.field = field;
  }
}

/** Invalid SDK usage detected before any request was sent. */
export class ZohoConfigError extends ZohoBooksError {
  constructor(message: string) {
    super(message, { status: 0 });
  }
}

const RATE_LIMIT_CODES = new Set([44, 45, 1070]);
const NOT_FOUND_CODES = new Set([1002]);

/** Map a failed response to the matching error class. */
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
