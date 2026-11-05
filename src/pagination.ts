/** `page_context` block returned by Zoho list endpoints. */
export interface PageContext {
  page: number;
  per_page: number;
  has_more_page: boolean;
  report_name?: string;
  applied_filter?: string;
  sort_column?: string;
  sort_order?: 'A' | 'D' | string;
  [key: string]: unknown;
}

export interface ListResult<T> {
  items: T[];
  pageContext: PageContext;
  hasMore: boolean;
}

export interface PaginationParams {
  /** 1-based page number. */
  page?: number;
  /** Records per page (Zoho max is 200). */
  per_page?: number;
}

export interface IterateOptions {
  /** Stop after yielding this many records. */
  limit?: number;
  /** Page size used while iterating. Default 200 (Zoho's max). */
  pageSize?: number;
}

export const MAX_PAGE_SIZE = 200;

/**
 * Generic auto-paginator: keeps fetching pages until `has_more_page` is
 * false or `limit` records were produced.
 */
export async function* paginate<T>(
  fetchPage: (page: number, perPage: number) => Promise<ListResult<T>>,
  options: IterateOptions & { startPage?: number } = {},
): AsyncGenerator<T, void, undefined> {
  const perPage = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? MAX_PAGE_SIZE));
  let page = options.startPage ?? 1;
  let yielded = 0;
  for (;;) {
    const result = await fetchPage(page, perPage);
    for (const item of result.items) {
      if (options.limit !== undefined && yielded >= options.limit) return;
      yielded++;
      yield item;
    }
    if (!result.hasMore || result.items.length === 0) return;
    if (options.limit !== undefined && yielded >= options.limit) return;
    page++;
  }
}

/** Drain an async iterable into an array. */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
