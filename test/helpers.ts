import type { FetchLike } from '../src/http/types.js';
import { ZohoBooks, type ZohoBooksOptions } from '../src/index.js';

export interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: BodyInit | null | undefined;
}

type Reply = Response | ((call: RecordedCall) => Response | Promise<Response>);

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json;charset=UTF-8', ...headers } });
}

/** Fake fetch that answers from a queue or from routes by method and path, recording every call. */
export function mockFetch(replies: Reply[] = []) {
  const calls: RecordedCall[] = [];
  const queue = [...replies];
  const routes: Array<{ method: string; path: string | RegExp; reply: Reply }> = [];

  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    let body: unknown = init?.body;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { url, method: init?.method ?? 'GET', headers, body, rawBody: init?.body };
    calls.push(call);

    if (init?.signal?.aborted) throw init.signal.reason ?? new Error('aborted');

    const route = routes.find(
      (r) => r.method === call.method && (typeof r.path === 'string' ? url.pathname.endsWith(r.path) : r.path.test(url.pathname)),
    );
    const reply = route?.reply ?? queue.shift();
    if (!reply) throw new Error(`Unexpected request ${call.method} ${url.pathname}`);
    const pending = Promise.resolve(typeof reply === 'function' ? reply(call) : reply.clone());
    const signal = init?.signal;
    if (!signal) return pending;
    return Promise.race([
      pending,
      new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    ]);
  };

  return {
    fetch,
    calls,
    on(method: string, path: string | RegExp, reply: Reply) {
      routes.push({ method, path, reply });
      return this;
    },
  };
}

export function testClient(fetch: FetchLike, overrides: Partial<ZohoBooksOptions> = {}): ZohoBooks {
  const client = new ZohoBooks({
    accessToken: 'test-token',
    organizationId: '600000001',
    dataCenter: 'in',
    fetch,
    rateLimit: false,
    retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, rateLimitDelayMs: 1 },
    ...overrides,
  });
  client.http.sleep = async () => {};
  return client;
}
