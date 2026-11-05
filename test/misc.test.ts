import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DATA_CENTERS,
  Scopes,
  ZohoBooks,
  ZohoConfigError,
  ZohoOAuth,
  computeWebhookSignature,
  dataCenterFromUrl,
  resolveDataCenter,
  scope,
  verifyWebhookSignature,
} from '../src/index.js';
import { json, mockFetch } from './helpers.js';

describe('webhooks', () => {
  const secret = 's3cr3t';
  const rawBody = '{"invoice":{"invoice_id":"1"}}';

  it('matches the documented algorithm (sorted key+value pairs, then raw body)', () => {
    const expected = createHmac('sha256', secret).update('a1b2' + rawBody).digest('base64');
    expect(computeWebhookSignature({ secret, query: { b: '2', a: '1' }, rawBody })).toBe(expected);
  });

  it('verifies and rejects in constant time', () => {
    const sig = computeWebhookSignature({ secret, rawBody });
    expect(verifyWebhookSignature({ secret, signature: sig, rawBody })).toBe(true);
    expect(verifyWebhookSignature({ secret, signature: sig, rawBody: rawBody + ' ' })).toBe(false);
    expect(verifyWebhookSignature({ secret: 'other', signature: sig, rawBody })).toBe(false);
    expect(verifyWebhookSignature({ secret, signature: undefined, rawBody })).toBe(false);
  });

  it('handles form payloads and Buffers', () => {
    const form = new URLSearchParams({ invoice_id: '1', status: 'paid' });
    const sig = computeWebhookSignature({ secret, form });
    expect(sig).toBe(createHmac('sha256', secret).update('invoice_id1statuspaid').digest('base64'));
    expect(verifyWebhookSignature({ secret, signature: computeWebhookSignature({ secret, rawBody }), rawBody: Buffer.from(rawBody) })).toBe(true);
  });
});

describe('data centers', () => {
  it('has correct Canada and India hosts', () => {
    expect(DATA_CENTERS.ca.accountsUrl).toBe('https://accounts.zohocloud.ca');
    expect(DATA_CENTERS.in.apiDomain).toBe('https://www.zohoapis.in');
    expect(DATA_CENTERS.ae.accountsUrl).toBe('https://accounts.zoho.ae');
  });
  it('never silently falls back', () => {
    expect(() => resolveDataCenter('xx' as never)).toThrow(/Unknown Zoho data center/);
  });
  it('detects DC from URLs', () => {
    expect(dataCenterFromUrl('https://www.zohoapis.com.au')).toBe('au');
    expect(dataCenterFromUrl('https://accounts.zoho.in/oauth')).toBe('in');
    expect(dataCenterFromUrl('nope')).toBeUndefined();
  });
});

describe('OAuth helper', () => {
  it('builds consent URLs', () => {
    const oauth = new ZohoOAuth({ clientId: 'cid', clientSecret: 'x', dataCenter: 'in' });
    const url = new URL(oauth.authorizationUrl({ scopes: Scopes.invoicing(), redirectUri: 'https://app/cb', prompt: 'consent', state: 'abc' }));
    expect(url.origin + url.pathname).toBe('https://accounts.zoho.in/oauth/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('ZohoBooks.invoices.ALL');
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('exchanges codes with a form body by default, query on request', async () => {
    const m = mockFetch([json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }), json({ access_token: 'b', expires_in: 3600 })]);
    const body = new ZohoOAuth({ clientId: 'cid', clientSecret: 'sec', fetch: m.fetch });
    const tokens = await body.exchangeCode('code123', 'https://app/cb');
    expect(tokens.refresh_token).toBe('r');
    expect(String(m.calls[0]!.rawBody)).toContain('code=code123');
    expect(m.calls[0]!.url.search).toBe('');

    const query = new ZohoOAuth({ clientId: 'cid', clientSecret: 'sec', fetch: m.fetch, tokenParamsIn: 'query' });
    await query.refresh('rt');
    expect(m.calls[1]!.url.searchParams.get('grant_type')).toBe('refresh_token');
    expect(m.calls[1]!.rawBody).toBeNull();
  });
});

describe('scopes', () => {
  it('formats scopes', () => {
    expect(scope('invoices', 'CREATE')).toBe('ZohoBooks.invoices.CREATE');
    expect(Scopes.all()).toContain('ZohoBooks.settings.ALL');
    expect(Scopes.readOnly().every((s) => s.endsWith('.READ'))).toBe(true);
  });
});

describe('ZohoBooks construction', () => {
  it('requires credentials', () => {
    expect(() => new ZohoBooks({})).toThrow(ZohoConfigError);
    expect(() => new ZohoBooks({ clientId: 'x' })).toThrow(/clientSecret, refreshToken/);
  });

  it('fromEnv reads standard variables', () => {
    const books = ZohoBooks.fromEnv({}, {
      ZOHO_CLIENT_ID: 'c',
      ZOHO_CLIENT_SECRET: 's',
      ZOHO_REFRESH_TOKEN: 'r',
      ZOHO_ORGANIZATION_ID: '42',
      ZOHO_DATA_CENTER: 'in',
    });
    expect(books.organizationId).toBe('42');
    expect(books.http.baseUrl).toBe('https://www.zohoapis.in/books/v3');
  });

  it('baseUrl override for proxies/mocks', () => {
    const books = new ZohoBooks({ accessToken: 't', baseUrl: 'http://localhost:4010/books/v3/' });
    expect(books.http.baseUrl).toBe('http://localhost:4010/books/v3');
  });
});
