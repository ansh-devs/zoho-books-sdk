import { randomUUID } from 'node:crypto';
import type { AuthProvider } from '../auth/providers.js';
import {
  ZohoBooksError,
  ZohoConfigError,
  ZohoNetworkError,
  ZohoOAuthError,
  ZohoRateLimitError,
  ZohoTimeoutError,
  errorFromResponse,
} from '../errors.js';
import { SdkLogger, type LogFields } from '../logging/logger.js';
import { RateLimiter, type RateLimiterOptions } from './rate-limiter.js';
import type { BinaryResponse, FetchLike, Hooks, Query, RequestOptions } from './types.js';

declare const __SDK_VERSION__: string;

export interface RetryOptions {
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Base backoff delay. Default 500 ms. */
  baseDelayMs?: number;
  /** Max backoff delay. Default 30 s. */
  maxDelayMs?: number;
  /** Wait after a 429 without Retry After. Default 60 s, Zoho's window. */
  rateLimitDelayMs?: number;
}

export interface HttpClientOptions {
  /** e.g. https://www.zohoapis.in/books/v3 */
  baseUrl: string;
  auth: AuthProvider;
  organizationId?: string | undefined;
  fetch?: FetchLike | undefined;
  timeoutMs?: number | undefined;
  retry?: RetryOptions | undefined;
  /** Client side throttling. false disables it. */
  rateLimit?: RateLimiterOptions | false | undefined;
  userAgent?: string | undefined;
  /** Switch to the api_domain Zoho returns with each token. Only zohoapis hosts are accepted. */
  followTokenApiDomain?: boolean | undefined;
  hooks?: Hooks | undefined;
  /** SDK logger. Silent when omitted. */
  log?: SdkLogger | undefined;
}

export const SDK_VERSION: string = typeof __SDK_VERSION__ === 'string' ? __SDK_VERSION__ : 'dev';
const RETRYABLE_METHODS = new Set(['GET', 'PUT', 'DELETE', 'PATCH']);

/** Token that failed with each error, kept off the error object so logs never show it. */
const failedTokens = new WeakMap<ZohoBooksError, string>();

/** Wait ms, or reject early with the abort reason. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class HttpClient {
  baseUrl: string;
  organizationId: string | undefined;
  private readonly auth: AuthProvider;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryOptions>;
  private readonly limiter: RateLimiter | undefined;
  private readonly userAgent: string;
  private readonly hooks: Hooks;
  private readonly log: SdkLogger;
  private readonly followTokenApiDomain: boolean;
  /** @internal replaceable in tests */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.auth = options.auth;
    this.organizationId = options.organizationId;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') {
      throw new ZohoConfigError('No fetch implementation found. Use Node.js 18.17 or newer, or pass fetch in the options.');
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.retry = {
      maxRetries: options.retry?.maxRetries ?? 3,
      baseDelayMs: options.retry?.baseDelayMs ?? 500,
      maxDelayMs: options.retry?.maxDelayMs ?? 30_000,
      rateLimitDelayMs: options.retry?.rateLimitDelayMs ?? 60_000,
    };
    this.limiter = options.rateLimit === false ? undefined : new RateLimiter(options.rateLimit ?? {});
    this.userAgent = options.userAgent ?? `zoho-books-sdk-node/${SDK_VERSION}`;
    this.hooks = options.hooks ?? {};
    this.log = options.log ?? SdkLogger.silent();
    this.followTokenApiDomain = options.followTokenApiDomain ?? false;
  }

  /** Send a request and return the parsed JSON envelope, or the bytes for binary. */
  async request<T = Record<string, unknown>>(options: RequestOptions & { responseType?: 'json' }): Promise<T>;
  async request(options: RequestOptions & { responseType: 'binary' }): Promise<BinaryResponse>;
  async request(options: RequestOptions): Promise<unknown> {
    const canRetryAll = options.idempotent ?? RETRYABLE_METHODS.has(options.method);
    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();
    const base = (): LogFields => ({
      requestId,
      method: options.method,
      path: options.path,
      organizationId: options.organizationId || this.organizationId,
      ...(options.query ? { query: options.query } : {}),
    });

    let authRetried = false;
    for (let attempt = 1; ; attempt++) {
      try {
        const queuedAt = Date.now();
        const run = () => {
          const waitMs = Date.now() - queuedAt;
          if (waitMs >= 1000) {
            this.log.debug('http', 'zoho.request.throttled', `Waited ${waitMs} ms for the rate limiter`, () => ({ ...base(), waitMs }));
          }
          return this.once(options, attempt, base);
        };
        return await (this.limiter ? this.limiter.schedule(run, options.signal) : run());
      } catch (error) {
        if (!(error instanceof ZohoBooksError)) {
          this.log.debug('http', 'zoho.request.aborted', 'Request aborted by the caller', base);
          throw error;
        }
        // Token failures are logged once, by the auth provider.
        if (error instanceof ZohoOAuthError) throw error;

        // Nothing was processed on 401, so one refresh and replay is safe for any method.
        if (error.status === 401 && !authRetried && this.auth.invalidate) {
          this.log.warn('auth', 'zoho.token.rejected', 'Zoho rejected the access token; refreshing and retrying once', () => ({
            ...base(),
            status: 401,
            code: error.code,
          }));
          authRetried = true;
          if (await this.auth.invalidate(failedTokens.get(error) ?? '')) {
            attempt--;
            continue;
          }
        }

        // Zoho rejects 429s before processing, so they are retried for every method except the daily quota.
        const isRateLimit = error instanceof ZohoRateLimitError;
        const retryable = isRateLimit ? error.retryable : error.retryable && canRetryAll;
        if (!retryable || attempt > this.retry.maxRetries || options.signal?.aborted) {
          this.logFailure(error, attempt, startedAt, base);
          throw error;
        }

        const delayMs = this.backoff(attempt, error);
        if (isRateLimit && error.kind !== 'concurrency') this.limiter?.pause(delayMs);
        this.hooks.onRetry?.({
          method: options.method,
          url: this.buildUrl(options.path, options.query, options.organizationId),
          attempt,
          delayMs,
          error,
        });
        const retryFields = () => ({ ...base(), attempt, delayMs, status: error.status, code: error.code, error: error.name });
        if (isRateLimit) {
          this.log.warn('http', 'zoho.request.rate_limited', `Zoho ${error.kind} rate limit hit; retrying in ${delayMs} ms`, () => ({
            ...retryFields(),
            kind: error.kind,
          }));
        } else {
          const what = error.status ? `HTTP ${error.status}` : error.name;
          this.log.warn('http', 'zoho.request.retry', `${what}; retrying in ${delayMs} ms (attempt ${attempt})`, retryFields);
        }
        await this.sleep(delayMs, options.signal);
      }
    }
  }

  /** Log a request that will not be retried. Server, network and auth failures are errors; the rest are warnings. */
  private logFailure(error: ZohoBooksError, attempts: number, startedAt: number, base: () => LogFields): void {
    const isRateLimit = error instanceof ZohoRateLimitError;
    const severe = error.status === 0 || error.status >= 500 || error.status === 401 || error.status === 403 || (isRateLimit && error.kind === 'daily');
    const zohoMessage = error.body && typeof error.body === 'object' ? (error.body as { message?: unknown }).message : undefined;
    this.log.log(severe ? 'error' : 'warn', 'http', isRateLimit ? 'zoho.request.rate_limited' : 'zoho.request.failed', error.message, () => ({
      ...base(),
      status: error.status,
      code: error.code,
      error: error.name,
      ...(isRateLimit ? { kind: error.kind } : {}),
      ...(zohoMessage !== undefined ? { zohoMessage } : {}),
      attempts,
      durationMs: Date.now() - startedAt,
      ...(this.log.bodies !== 'none' && error.body !== undefined ? { responseBody: this.log.body(error.body) } : {}),
    }));
  }

  private async once(options: RequestOptions, attempt: number, base: () => LogFields): Promise<unknown> {
    const token = await this.auth.getAccessToken();
    if (this.followTokenApiDomain) this.adoptApiDomain(this.auth.getApiDomain?.());
    const url = this.buildUrl(options.path, options.query, options.organizationId);
    const headers: Record<string, string> = {
      authorization: `Zoho-oauthtoken ${token}`,
      accept: options.responseType === 'binary' ? '*/*' : 'application/json',
      'user-agent': this.userAgent,
      ...lowerKeys(options.headers),
    };

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? anySignal([options.signal, timeoutSignal]) : timeoutSignal;

    this.hooks.onRequest?.({ method: options.method, url, attempt });
    this.log.trace('http', 'zoho.request.started', `${options.method} ${options.path}`, () => ({
      ...base(),
      attempt,
      ...(this.log.bodies === 'all' && options.body !== undefined ? { requestBody: this.log.body(options.body) } : {}),
    }));
    const started = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: options.method, headers, body: body ?? null, signal });
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      if (timeoutSignal.aborted) {
        throw new ZohoTimeoutError(`Request timed out after ${timeoutMs} ms`, {
          status: 0,
          method: options.method,
          path: options.path,
          cause,
        });
      }
      throw new ZohoNetworkError(`Network error: ${(cause as Error)?.message ?? String(cause)}`, {
        status: 0,
        method: options.method,
        path: options.path,
        cause,
      });
    }
    this.hooks.onResponse?.({ method: options.method, url, attempt, status: res.status, durationMs: Date.now() - started });
    const completed = (extra: LogFields) =>
      this.log.debug('http', 'zoho.request.completed', `${options.method} ${options.path} ${res.status}`, () => ({
        ...base(),
        status: res.status,
        attempt,
        durationMs: Date.now() - started,
        ...extra,
      }));

    const contentType = res.headers.get('content-type') ?? undefined;
    const isJson = contentType?.includes('json') ?? false;

    if (options.responseType === 'binary' && res.ok && !isJson) {
      const data = new Uint8Array(await res.arrayBuffer());
      completed({ bytes: data.byteLength, contentType });
      return { data, contentType, filename: parseFilename(res.headers.get('content-disposition')) } satisfies BinaryResponse;
    }

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        if (res.ok) {
          throw new ZohoNetworkError('Zoho returned a non JSON response', {
            status: res.status,
            method: options.method,
            path: options.path,
            body: text.slice(0, 2000),
            cause,
          });
        }
        parsed = { message: text.slice(0, 500) };
      }
    }

    const code = readCode(parsed);
    if (!res.ok || (code !== undefined && code !== 0)) {
      const err = errorFromResponse({
        status: res.status,
        code,
        method: options.method,
        path: options.path,
        body: parsed,
        headers: headersToObject(res.headers),
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
      });
      failedTokens.set(err, token);
      throw err;
    }
    completed(this.log.bodies === 'all' ? { responseBody: this.log.body(parsed) } : {});
    return parsed ?? {};
  }

  buildUrl(path: string, query: Query | undefined, organizationId: string | undefined): string {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    const org = organizationId ?? this.organizationId;
    if (org && !query?.organization_id) url.searchParams.set('organization_id', org);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
      }
    }
    return url.toString();
  }

  private adoptApiDomain(apiDomain: string | undefined): void {
    if (!apiDomain) return;
    let host: string;
    try {
      host = new URL(apiDomain).host.toLowerCase();
    } catch {
      return;
    }
    // Never send the token to a host outside Zoho.
    if (!/^(www\.)?zohoapis\.[a-z.]+$/.test(host)) return;
    const next = `https://${host}/books/v3`;
    if (next !== this.baseUrl) {
      this.log.info('auth', 'zoho.api_domain.switched', `Using API host ${next} from the token's api_domain`, { from: this.baseUrl, to: next });
      this.baseUrl = next;
    }
  }

  private backoff(attempt: number, error: ZohoBooksError): number {
    if (error instanceof ZohoRateLimitError && error.kind !== 'concurrency') {
      return Math.min(error.retryAfterMs ?? this.retry.rateLimitDelayMs, Math.max(this.retry.maxDelayMs, 60_000));
    }
    const exp = this.retry.baseDelayMs * 2 ** (attempt - 1);
    return Math.min(this.retry.maxDelayMs, Math.round(Math.random() * exp) + 1);
  }
}

function readCode(body: unknown): number | undefined {
  if (body && typeof body === 'object' && 'code' in body) {
    const c = (body as { code: unknown }).code;
    if (typeof c === 'number') return c;
    if (typeof c === 'string' && /^\d+$/.test(c)) return Number(c);
  }
  return undefined;
}

function lowerKeys(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (h) for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function parseFilename(cd: string | null): string | undefined {
  if (!cd) return undefined;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star?.[1]) return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain?.[1]?.trim();
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (anyFn) return anyFn(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
