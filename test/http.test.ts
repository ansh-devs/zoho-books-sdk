import { describe, expect, it } from 'vitest';
import {
  RefreshTokenAuth,
  ZohoAuthenticationError,
  ZohoNotFoundError,
  ZohoRateLimitError,
  ZohoServerError,
  ZohoTimeoutError,
  ZohoValidationError,
} from '../src/index.js';
import { json, mockFetch, testClient } from './helpers.js';

describe('HttpClient', () => {
  it('sends Zoho-oauthtoken auth, organization_id and the DC base URL', async () => {
    const m = mockFetch([json({ code: 0, message: 'success', invoice: { invoice_id: '1' } })]);
    const books = testClient(m.fetch);
    const inv = await books.invoices.get('1');
    expect(inv.invoice_id).toBe('1');
    const call = m.calls[0]!;
    expect(call.url.origin).toBe('https://www.zohoapis.in');
    expect(call.url.pathname).toBe('/books/v3/invoices/1');
    expect(call.url.searchParams.get('organization_id')).toBe('600000001');
    expect(call.headers.authorization).toBe('Zoho-oauthtoken test-token');
  });

  it('throws on a non-zero Zoho code even with HTTP 200', async () => {
    const m = mockFetch([json({ code: 4, message: 'Invalid value passed for customer_id' })]);
    const books = testClient(m.fetch);
    const err = await books.invoices.create({ customer_id: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZohoValidationError);
    expect((err as ZohoValidationError).code).toBe(4);
    expect((err as ZohoValidationError).message).toContain('Invalid value passed');
    expect((err as ZohoValidationError).method).toBe('POST');
  });

  it('maps 1002 to ZohoNotFoundError', async () => {
    const m = mockFetch([json({ code: 1002, message: 'Invoice does not exist.' }, 400)]);
    const err = await testClient(m.fetch).invoices.get('9').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZohoNotFoundError);
  });

  it('retries GET on 5xx and succeeds', async () => {
    const m = mockFetch([json({ code: 1000, message: 'Internal error' }, 500), json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } })]);
    const inv = await testClient(m.fetch).invoices.get('1');
    expect(inv.invoice_id).toBe('1');
    expect(m.calls).toHaveLength(2);
  });

  it('does NOT retry POST on 5xx (avoids duplicate invoices)', async () => {
    const m = mockFetch([json({ code: 1000, message: 'Internal error' }, 500), json({ code: 0, message: 'ok', invoice: {} })]);
    const err = await testClient(m.fetch).invoices.create({ customer_id: '1' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZohoServerError);
    expect(m.calls).toHaveLength(1);
  });

  it('retries POST on per-minute 429 (rejected before processing)', async () => {
    const m = mockFetch([
      json({ code: 44, message: 'You have made too many requests' }, 429),
      json({ code: 0, message: 'ok', invoice: { invoice_id: '7' } }),
    ]);
    const inv = await testClient(m.fetch).invoices.create({ customer_id: '1' });
    expect(inv.invoice_id).toBe('7');
    expect(m.calls).toHaveLength(2);
  });

  it('fails fast on the daily quota (code 45)', async () => {
    const m = mockFetch([json({ code: 45, message: 'You have exceeded the maximum call rate limit of 1000.' }, 429)]);
    const err = await testClient(m.fetch).invoices.get('1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZohoRateLimitError);
    expect((err as ZohoRateLimitError).kind).toBe('daily');
    expect((err as ZohoRateLimitError).retryable).toBe(false);
    expect(m.calls).toHaveLength(1);
  });

  it('classifies concurrency limit (1070) as retryable', async () => {
    const m = mockFetch([json({ code: 1070, message: 'maximum number of in process requests' }, 429), json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } })]);
    await testClient(m.fetch).invoices.get('1');
    expect(m.calls).toHaveLength(2);
  });

  it('refreshes the token once on 401 and replays the request', async () => {
    let tokenCalls = 0;
    const m = mockFetch()
      .on('POST', '/oauth/v2/token', () => {
        tokenCalls++;
        return json({ access_token: `tok-${tokenCalls}`, expires_in: 3600, api_domain: 'https://www.zohoapis.in' });
      })
      .on('GET', '/invoices/1', (call) =>
        call.headers.authorization === 'Zoho-oauthtoken tok-1'
          ? json({ code: 57, message: 'You are not authorized to perform this operation' }, 401)
          : json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } }),
      );
    const books = testClient(m.fetch, { accessToken: undefined, clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' });
    const inv = await books.invoices.get('1');
    expect(inv.invoice_id).toBe('1');
    expect(tokenCalls).toBe(2);
  });

  it('gives up after one refresh when 401 persists', async () => {
    const m = mockFetch()
      .on('POST', '/oauth/v2/token', () => json({ access_token: 'tok', expires_in: 3600 }))
      .on('GET', '/invoices/1', () => json({ code: 14, message: 'Invalid OAuth token' }, 401));
    const books = testClient(m.fetch, { accessToken: undefined, clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' });
    await expect(books.invoices.get('1')).rejects.toBeInstanceOf(ZohoAuthenticationError);
  });

  it('times out slow requests', async () => {
    const m = mockFetch([() => new Promise<Response>(() => {})]);
    const books = testClient(m.fetch, { timeoutMs: 5, retry: { maxRetries: 0 } });
    await expect(books.contacts.list()).rejects.toBeInstanceOf(ZohoTimeoutError);
  });

  it('returns PDFs as bytes with filename', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const m = mockFetch([
      new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="INV-001.pdf"' } }),
    ]);
    const res = await testClient(m.fetch).invoices.pdf('1');
    expect(res.contentType).toBe('application/pdf');
    expect(res.filename).toBe('INV-001.pdf');
    expect([...res.data]).toEqual([...pdf]);
    expect(m.calls[0]!.url.searchParams.get('accept')).toBe('pdf');
  });

  it('follows api_domain from the token when no host was pinned', async () => {
    const m = mockFetch()
      .on('POST', '/oauth/v2/token', () => json({ access_token: 'tok', expires_in: 3600, api_domain: 'https://www.zohoapis.eu' }))
      .on('GET', '/organizations', () => json({ code: 0, message: 'ok', organizations: [] }));
    const books = testClient(m.fetch, {
      accessToken: undefined,
      dataCenter: undefined,
      accountsUrl: 'https://accounts.zoho.eu',
      clientId: 'c',
      clientSecret: 's',
      refreshToken: 'r',
    });
    await books.organizations.list();
    expect(m.calls[1]!.url.origin).toBe('https://www.zohoapis.eu');
    expect(m.calls[1]!.url.searchParams.has('organization_id')).toBe(false);
  });

  it('ignores a non-Zoho api_domain (token exfiltration guard)', async () => {
    const m = mockFetch()
      .on('POST', '/oauth/v2/token', () => json({ access_token: 'tok', expires_in: 3600, api_domain: 'https://evil.example.com' }))
      .on('GET', '/organizations', () => json({ code: 0, message: 'ok', organizations: [] }));
    const books = testClient(m.fetch, { accessToken: undefined, dataCenter: undefined, clientId: 'c', clientSecret: 's', refreshToken: 'r' });
    await books.organizations.list();
    expect(m.calls[1]!.url.origin).toBe('https://www.zohoapis.com');
  });

  it('exposes hooks', async () => {
    const events: string[] = [];
    const m = mockFetch([json({ code: 1000, message: 'x' }, 503), json({ code: 0, message: 'ok', contacts: [] })]);
    const books = testClient(m.fetch, {
      hooks: {
        onRequest: (e) => events.push(`req:${e.attempt}`),
        onResponse: (e) => events.push(`res:${e.status}`),
        onRetry: (e) => events.push(`retry:${e.attempt}`),
      },
    });
    await books.contacts.list();
    expect(events).toEqual(['req:1', 'res:503', 'retry:1', 'req:2', 'res:200']);
  });
});

describe('RefreshTokenAuth', () => {
  it('single-flights concurrent refreshes and caches the token', async () => {
    let calls = 0;
    const m = mockFetch().on('POST', '/oauth/v2/token', async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return json({ access_token: 'shared', expires_in: 3600 });
    });
    const auth = new RefreshTokenAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r', dataCenter: 'in', fetch: m.fetch });
    const tokens = await Promise.all(Array.from({ length: 20 }, () => auth.getAccessToken()));
    expect(new Set(tokens)).toEqual(new Set(['shared']));
    expect(calls).toBe(1);
    await auth.getAccessToken();
    expect(calls).toBe(1);
    expect(m.calls[0]!.url.origin).toBe('https://accounts.zoho.in');
    expect(String(m.calls[0]!.rawBody)).toContain('grant_type=refresh_token');
  });

  it('refreshes ahead of expiry', async () => {
    let n = 0;
    const m = mockFetch().on('POST', '/oauth/v2/token', () => json({ access_token: `t${++n}`, expires_in: 3600 }));
    const auth = new RefreshTokenAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: m.fetch });
    let now = 1_000_000;
    auth.now = () => now;
    expect(await auth.getAccessToken()).toBe('t1');
    now += 3600_000 - 4 * 60_000; // inside the 5 min skew
    expect(await auth.getAccessToken()).toBe('t2');
  });

  it('treats `{ error }` with HTTP 200 as an OAuth failure', async () => {
    const m = mockFetch([json({ error: 'invalid_code' })]);
    const auth = new RefreshTokenAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: m.fetch });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ name: 'ZohoOAuthError', oauthError: 'invalid_code' });
  });

  it('uses a shared token store and its lock', async () => {
    const store = new Map<string, unknown>();
    let locks = 0;
    const m = mockFetch([json({ access_token: 'from-zoho', expires_in: 3600 })]);
    const tokenStore = {
      get: (k: string) => store.get(k) as never,
      set: (k: string, v: unknown) => void store.set(k, v),
      delete: (k: string) => void store.delete(k),
      withLock: async <T>(_k: string, fn: () => Promise<T>) => {
        locks++;
        return fn();
      },
    };
    const a = new RefreshTokenAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: m.fetch, tokenStore });
    const b = new RefreshTokenAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: m.fetch, tokenStore });
    expect(await a.getAccessToken()).toBe('from-zoho');
    expect(await b.getAccessToken()).toBe('from-zoho'); // served from the shared store, no second refresh
    expect(m.calls).toHaveLength(1);
    expect(locks).toBe(1);
  });
});
