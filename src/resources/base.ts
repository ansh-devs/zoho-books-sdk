import type { HttpClient } from '../http/http-client.js';
import type { BinaryResponse, CallOptions, HttpMethod, Query } from '../http/types.js';
import { paginate, collect, type IterateOptions, type ListResult, type PageContext } from '../pagination.js';

export interface ResourceConfig {
  /** URL segment, e.g. `invoices`. */
  path: string;
  /** Response key for a single record, e.g. `invoice`. */
  singular: string;
  /** Response key for lists, e.g. `invoices`. */
  plural: string;
  /**
   * Alternative keys seen in the wild (Zoho is not always consistent, e.g.
   * `customerpayments` vs `customer_payments`). Tried after `singular`/`plural`.
   */
  aliases?: string[];
}

const ENVELOPE_KEYS = new Set(['code', 'message', 'page_context']);

/** Pick the record array out of a list response, tolerating key drift. */
export function extractList<T>(res: Record<string, unknown>, keys: string[]): T[] {
  for (const k of keys) {
    if (Array.isArray(res[k])) return res[k] as T[];
  }
  for (const [k, v] of Object.entries(res)) {
    if (!ENVELOPE_KEYS.has(k) && Array.isArray(v)) return v as T[];
  }
  return [];
}

/** Pick the record out of a single-record response, tolerating key drift. */
export function extractOne<T>(res: Record<string, unknown>, keys: string[]): T {
  for (const k of keys) {
    const v = res[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as T;
  }
  // Some endpoints (e.g. chart of accounts) return the record flattened into the envelope.
  const { code: _c, message: _m, ...rest } = res;
  return rest as T;
}

/** Zoho's `{ code, message }` envelope. */
export interface ZohoEnvelope {
  code: number;
  message: string;
  [key: string]: unknown;
}

export type ListParams = Query & { page?: number; per_page?: number };

/** Shared plumbing for every resource. Public API lives on subclasses. */
export abstract class BaseResource {
  constructor(
    protected readonly http: HttpClient,
    protected readonly config: ResourceConfig,
  ) {}

  protected url(...segments: Array<string | number>): string {
    return '/' + [this.config.path, ...segments.map((s) => encodeURIComponent(String(s)))].join('/');
  }

  protected call<T = ZohoEnvelope>(
    method: HttpMethod,
    path: string,
    init: { query?: Query | undefined; body?: unknown; idempotent?: boolean } = {},
    opts?: CallOptions,
  ): Promise<T> {
    return this.http.request<T>({
      method,
      path,
      query: init.query,
      body: init.body,
      idempotent: init.idempotent,
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
      query,
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
      query,
      formData: form,
      organizationId: opts?.organizationId,
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      headers: opts?.headers,
    });
  }

  protected async listPage<T>(path: string, key: string, params: ListParams | undefined, opts?: CallOptions): Promise<ListResult<T>> {
    const res = await this.call<Record<string, unknown>>('GET', path, { query: params }, opts);
    const items = extractList<T>(res, key === this.config.plural ? [key, ...(this.config.aliases ?? [])] : [key]);
    const pageContext = (res.page_context as PageContext | undefined) ?? {
      page: Number(params?.page ?? 1),
      per_page: Number(params?.per_page ?? items.length),
      has_more_page: false,
    };
    return { items, pageContext, hasMore: Boolean(pageContext.has_more_page) };
  }

  protected iteratePages<T>(
    path: string,
    key: string,
    params: ListParams | undefined,
    options: IterateOptions = {},
    opts?: CallOptions,
  ): AsyncGenerator<T, void, undefined> {
    const { page, per_page, ...rest } = params ?? {};
    return paginate<T>(
      (p, pp) => this.listPage<T>(path, key, { ...rest, page: p, per_page: pp }, opts),
      { ...options, pageSize: options.pageSize ?? (per_page as number | undefined), startPage: page as number | undefined },
    );
  }

  protected async one<T>(method: HttpMethod, path: string, init: { query?: Query | undefined; body?: unknown } = {}, opts?: CallOptions, key = this.config.singular): Promise<T> {
    const res = await this.call<Record<string, unknown>>(method, path, init, opts);
    return extractOne<T>(res, key === this.config.singular ? [key, ...(this.config.aliases ?? [])] : [key]);
  }
}

/**
 * Resource with the standard list/get/create/update/delete endpoints.
 * Type params: model, create input, update input, list filters.
 */
export class CrudResource<
  T,
  TCreate = Partial<T>,
  TUpdate = Partial<TCreate>,
  TListParams extends ListParams = ListParams,
> extends BaseResource {
  /** Fetch one page. */
  list(params?: TListParams, opts?: CallOptions): Promise<ListResult<T>> {
    return this.listPage<T>(this.url(), this.config.plural, params, opts);
  }

  /** Iterate every record across pages: `for await (const x of r.iterate())`. */
  iterate(params?: TListParams, options?: IterateOptions, opts?: CallOptions): AsyncGenerator<T, void, undefined> {
    return this.iteratePages<T>(this.url(), this.config.plural, params, options, opts);
  }

  /** Fetch every record across pages into an array. Use `limit` on big orgs. */
  listAll(params?: TListParams, options?: IterateOptions, opts?: CallOptions): Promise<T[]> {
    return collect(this.iterate(params, options, opts));
  }

  get(id: string, query?: Query, opts?: CallOptions): Promise<T> {
    return this.one<T>('GET', this.url(id), { query }, opts);
  }

  create(data: TCreate, query?: Query, opts?: CallOptions): Promise<T> {
    return this.one<T>('POST', this.url(), { body: data, query }, opts);
  }

  update(id: string, data: TUpdate, query?: Query, opts?: CallOptions): Promise<T> {
    return this.one<T>('PUT', this.url(id), { body: data, query }, opts);
  }

  async delete(id: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id), {}, opts);
  }

  /** Run a status action such as `POST /invoices/{id}/status/sent`. */
  protected async action(id: string, segments: string[], init: { body?: unknown; query?: Query } = {}, opts?: CallOptions, method: HttpMethod = 'POST'): Promise<string> {
    const res = await this.call(method, this.url(id, ...segments), init, opts);
    return res.message;
  }
}
