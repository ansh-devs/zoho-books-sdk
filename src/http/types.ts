export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  method: HttpMethod;
  /** Path relative to /books/v3, e.g. /invoices/123 */
  path: string;
  query?: Query | undefined;
  /** JSON body. */
  body?: unknown;
  /** Multipart body for uploads. */
  formData?: FormData | undefined;
  /** json (default) or binary for files. */
  responseType?: 'json' | 'binary' | undefined;
  headers?: Record<string, string> | undefined;
  /** Organization for this call instead of the client default. */
  organizationId?: string | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  /** Allow retrying a POST after 5xx or timeout. 429 is always retried. */
  idempotent?: boolean | undefined;
}

/** Options accepted as the last argument of every resource method. */
export interface CallOptions {
  /** Organization for this call instead of the client default. */
  organizationId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Extra query parameters the typed method does not cover. */
  query?: Query;
}

export interface BinaryResponse {
  data: Uint8Array;
  contentType: string | undefined;
  /** Filename from Content Disposition, if sent. */
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
