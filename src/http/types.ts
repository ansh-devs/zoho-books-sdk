export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method: HttpMethod;
  /** Path relative to `/books/v3`, e.g. `/invoices/123`. */
  path: string;
  query?: Query | undefined;
  /** JSON body. Mutually exclusive with `formData`. */
  body?: unknown;
  /** Multipart body (attachments, imports). */
  formData?: FormData | undefined;
  /** How to read the response. Default `json`. */
  responseType?: 'json' | 'binary' | undefined;
  /** Extra headers (e.g. `Accept: application/pdf`). */
  headers?: Record<string, string> | undefined;
  /** Override the client's organization id for this call. */
  organizationId?: string | undefined;
  /** Per-call abort signal. */
  signal?: AbortSignal | undefined;
  /** Per-call timeout override (ms). */
  timeoutMs?: number | undefined;
  /**
   * Mark a POST as safe to retry after 5xx/timeouts (it is always retried on
   * 429, which Zoho returns before processing). Default: false for POST.
   */
  idempotent?: boolean | undefined;
}

/** Per-call options accepted by every resource method. */
export interface CallOptions {
  organizationId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface BinaryResponse {
  data: Uint8Array;
  contentType: string | undefined;
  /** Filename from `Content-Disposition`, if present. */
  filename: string | undefined;
}

export interface RequestEvent {
  method: HttpMethod;
  url: string;
  attempt: number;
}

export interface ResponseEvent extends RequestEvent {
  status: number;
  durationMs: number;
}

export interface RetryEvent extends RequestEvent {
  delayMs: number;
  error: unknown;
}

export interface Hooks {
  onRequest?: (event: RequestEvent) => void;
  onResponse?: (event: ResponseEvent) => void;
  onRetry?: (event: RetryEvent) => void;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}
