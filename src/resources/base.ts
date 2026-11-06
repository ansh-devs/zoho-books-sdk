import { ZohoConfigError, ZohoNoRecordError } from '../errors.js';
import type { HttpClient } from '../http/http-client.js';
import type { BinaryResponse, CallOptions, HttpMethod, Query } from '../http/types.js';
import { paginate, collect, type IterateOptions, type ListResult, type PageContext } from '../pagination.js';
import type { CommonListParams } from '../types/common.js';

export interface ResourceConfig {
  /** URL segment, e.g. invoices or settings/taxes. */
  path: string;
  /** Response key of one record, e.g. invoice. */
  singular: string;
  /** Response key of a list, e.g. invoices. */
  plural: string;
  /** Other keys Zoho uses for the same data, tried after singular and plural. */
  aliases?: string[];
  /** The record comes back flattened into the envelope, as chart of accounts does. */
  flat?: boolean;
}

/** Zoho's code and message envelope. */
export interface ZohoEnvelope {
  code: number;
  message: string;
  [key: string]: unknown;
}

/** Options for iterate and listAll. */
export type IterateCallOptions = IterateOptions & CallOptions;

const ENVELOPE_KEYS = new Set(['code', 'message', 'page_context']);

/** Encode one path segment. An empty id would hit a list or bulk endpoint, so it throws. */
export function segment(value: string | number): string {
  const s = String(value ?? '');
  if (!s.trim()) throw new ZohoConfigError('Empty id in request path');
  return encodeURIComponent(s);
}

/** Record array from a list response, tolerating key drift. */
export function extractList<T>(res: Record<string, unknown>, keys: string[]): T[] {
  for (const k of keys) {
    if (Array.isArray(res[k])) return res[k] as T[];
  }
  for (const [k, v] of Object.entries(res)) {
    if (!ENVELOPE_KEYS.has(k) && Array.isArray(v)) return v as T[];
  }
  return [];
}

/** Record from a single record response. Throws rather than return the envelope as a record. */
export function extractOne<T>(res: Record<string, unknown>, keys: string[], flat = false): T {
  const isRecord = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  for (const k of keys) {
    if (isRecord(res[k])) return res[k] as T;
  }
  const others = Object.entries(res).filter(([k, v]) => !ENVELOPE_KEYS.has(k) && isRecord(v));
  if (others.length === 1) return others[0]![1] as T;
  if (flat) {
    const { code: _c, message: _m, ...rest } = res;
    return rest as T;
  }
  throw new ZohoNoRecordError(`Unexpected Zoho response: no "${keys[0]}" record`, { status: 200, body: res });
}

function mergeQuery(a: Query | undefined, b: Query | undefined): Query | undefined {
  return a && b ? { ...a, ...b } : (a ?? b);
}

/** Shared plumbing. Public methods live on subclasses. */
export abstract class BaseResource {
  constructor(
    protected readonly http: HttpClient,
    protected readonly config: ResourceConfig,
  ) {}

  protected url(...segments: Array<string | number>): string {
    return '/' + [this.config.path, ...segments.map(segment)].join('/');
  }

  protected call<T = ZohoEnvelope>(
    method: HttpMethod,
    path: string,
    init: { query?: Query | undefined; body?: unknown } = {},
    opts?: CallOptions,
  ): Promise<T> {
    return this.http.request<T>({
      method,
      path,
      query: mergeQuery(init.query, opts?.query),
      body: init.body,
      organizationId: opts?.organizationId,
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      headers: opts?.headers,
    });
  }

  protected binary(path: string, query: Query | undefined, accept: string, opts?: CallOptions): Promise<BinaryResponse> {
    return this.http.request({
      method: 'GET',
      path,
      query: mergeQuery(query, opts?.query),
      responseType: 'binary',
      headers: { accept, ...opts?.headers },
      organizationId: opts?.organizationId,
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
    });
  }

  protected upload(path: string, form: FormData, query?: Query, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.http.request<ZohoEnvelope>({
      method: 'POST',
      path,
      query: mergeQuery(query, opts?.query),
      formData: form,
      organizationId: opts?.organizationId,
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      headers: opts?.headers,
    });
  }

  protected async listPage<T>(path: string, key: string, params: object | undefined, opts?: CallOptions): Promise<ListResult<T>> {
    const query = params as Query | undefined;
    const res = await this.call<Record<string, unknown>>('GET', path, { query }, opts);
    const items = extractList<T>(res, key === this.config.plural ? [key, ...(this.config.aliases ?? [])] : [key]);
    const pageContext = (res.page_context as PageContext | undefined) ?? {
      page: Number(query?.page ?? 1),
      per_page: Number(query?.per_page ?? items.length),
      has_more_page: false,
    };
    return { items, pageContext, hasMore: Boolean(pageContext.has_more_page) };
  }

  protected iteratePages<T>(path: string, key: string, params: object | undefined, opts: IterateCallOptions = {}): AsyncGenerator<T, void, undefined> {
    const { page, per_page, ...rest } = (params ?? {}) as Query;
    const { limit, pageSize, ...callOpts } = opts;
    return paginate<T>((p, pp) => this.listPage<T>(path, key, { ...rest, page: p, per_page: pp }, callOpts), {
      limit,
      pageSize: pageSize ?? (per_page as number | undefined),
      startPage: page as number | undefined,
    });
  }

  protected async one<T>(
    method: HttpMethod,
    path: string,
    init: { query?: Query | undefined; body?: unknown } = {},
    opts?: CallOptions,
    key = this.config.singular,
  ): Promise<T> {
    const res = await this.call<Record<string, unknown>>(method, path, init, opts);
    const keys = key === this.config.singular ? [key, ...(this.config.aliases ?? [])] : [key];
    return extractOne<T>(res, keys, this.config.flat);
  }

  /** Update by a unique custom field instead of the id, creating the record when upsert is set. */
  protected upsert<T>(apiName: string, value: string, data: unknown, opts: CallOptions & { upsert?: boolean } = {}): Promise<T> {
    const { upsert, ...callOpts } = opts;
    const headers: Record<string, string> = {
      'X-Unique-Identifier-Key': apiName,
      'X-Unique-Identifier-Value': value,
      ...(upsert ? { 'X-Upsert': 'true' } : {}),
      ...callOpts.headers,
    };
    return this.one<T>('PUT', this.url(), { body: data }, { ...callOpts, headers });
  }
}

/** Resource with list, get, create, update and delete. */
export class CrudResource<
  T,
  TCreate = Partial<T>,
  TUpdate = Partial<TCreate>,
  TListParams extends object = CommonListParams,
> extends BaseResource {
  /** One page. */
  async list(params?: TListParams, opts?: CallOptions): Promise<ListResult<T>> {
    return this.listPage<T>(this.url(), this.config.plural, params, opts);
  }

  /** Every record, fetched page by page as you iterate. */
  iterate(params?: TListParams, opts?: IterateCallOptions): AsyncGenerator<T, void, undefined> {
    return this.iteratePages<T>(this.url(), this.config.plural, params, opts);
  }

  /** Every record in one array. Set limit on big organizations. */
  async listAll(params?: TListParams, opts?: IterateCallOptions): Promise<T[]> {
    return collect(this.iterate(params, opts));
  }

  async get(id: string, opts?: CallOptions): Promise<T> {
    return this.one<T>('GET', this.url(id), {}, opts);
  }

  async create(data: TCreate, opts?: CallOptions): Promise<T> {
    return this.one<T>('POST', this.url(), { body: data }, opts);
  }

  async update(id: string, data: TUpdate, opts?: CallOptions): Promise<T> {
    return this.one<T>('PUT', this.url(id), { body: data }, opts);
  }

  async delete(id: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id), {}, opts);
  }

  /** Run an action such as POST /invoices/{id}/status/sent and return Zoho's message. */
  protected async action(
    id: string,
    segments: string[],
    init: { body?: unknown; query?: Query } = {},
    opts?: CallOptions,
    method: HttpMethod = 'POST',
  ): Promise<string> {
    const res = await this.call(method, this.url(id, ...segments), init, opts);
    return res.message;
  }
}
