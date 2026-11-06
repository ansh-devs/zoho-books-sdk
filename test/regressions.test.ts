import { inspect } from 'node:util';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RateLimiter, ZohoBooks, ZohoConfigError, ZohoNotFoundError, roundMoney, computeGst } from '../src/index.js';
import { json, mockFetch, testClient } from './helpers.js';

describe('money rounding on large amounts', () => {
  it('keeps crore values exact', () => {
    expect(roundMoney(5_000_000)).toBe(5_000_000);
    expect(roundMoney(4_999_999.99)).toBe(4_999_999.99);
    expect(roundMoney(123_456_789.12)).toBe(123_456_789.12);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
  });

  it('computes GST on a ₹50 lakh line without drift', () => {
    const r = computeGst([{ quantity: 1, rate: 5_000_000, gstRate: 18 }], { supplyType: 'inter' });
    expect(r.taxableValue).toBe(5_000_000);
    expect(r.igst).toBe(900_000);
    expect(r.total).toBe(5_900_000);
  });
});

describe('access token stays out of errors', () => {
  it('is not visible when the error is logged or serialized', async () => {
    const m = mockFetch([json({ code: 1002, message: 'Invoice does not exist.' }, 404)]);
    const books = testClient(m.fetch, { accessToken: '1000.SECRET_TOKEN' });
    const err = await books.invoices.get('9').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ZohoNotFoundError);
    expect(JSON.stringify(err)).not.toContain('SECRET_TOKEN');
    expect(inspect(err)).not.toContain('SECRET_TOKEN');
  });
});

describe('call options as the second argument', () => {
  it('routes create, get and update to the requested organization', async () => {
    const m = mockFetch().on('POST', /.*/, () => json({ code: 0, message: 'ok', contact: { contact_id: 'c' } }))
      .on('GET', /.*/, () => json({ code: 0, message: 'ok', contact: { contact_id: 'c' } }))
      .on('PUT', /.*/, () => json({ code: 0, message: 'ok', contact: { contact_id: 'c' } }));
    const books = testClient(m.fetch);
    await books.contacts.create({ contact_name: 'x' }, { organizationId: 'B' });
    await books.contacts.get('c', { organizationId: 'B' });
    await books.contacts.update('c', { contact_name: 'y' }, { organizationId: 'B', query: { extra: 1 } });
    expect(m.calls.map((c) => c.url.searchParams.get('organization_id'))).toEqual(['B', 'B', 'B']);
    expect(m.calls.some((c) => c.url.searchParams.has('organizationId'))).toBe(false);
    expect(m.calls[2]!.url.searchParams.get('extra')).toBe('1');
  });

  it('credit note invoiceId goes to the query and the options object is untouched', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', creditnote: { creditnote_id: 'cn' } })]);
    const opts = { invoiceId: 'inv1', send: false };
    await testClient(m.fetch).creditNotes.create({ customer_id: 'c' }, opts);
    expect(m.calls[0]!.url.searchParams.get('invoice_id')).toBe('inv1');
    expect(m.calls[0]!.url.searchParams.get('send')).toBe('false');
    expect(opts).toEqual({ invoiceId: 'inv1', send: false });
  });
});

describe('empty ids', () => {
  it('throw before any request instead of hitting list or bulk endpoints', async () => {
    const m = mockFetch();
    const books = testClient(m.fetch);
    await expect(books.invoices.get('')).rejects.toBeInstanceOf(ZohoConfigError);
    await expect(books.invoices.update(' ', {})).rejects.toBeInstanceOf(ZohoConfigError);
    await expect(books.invoices.delete('')).rejects.toBeInstanceOf(ZohoConfigError);
    await expect(books.invoices.einvoice.push('')).rejects.toBeInstanceOf(ZohoConfigError);
    await expect(books.contacts.persons.create('', { first_name: 'a' })).rejects.toBeInstanceOf(ZohoConfigError);
    expect(m.calls).toHaveLength(0);
  });
});

describe('endpoint paths', () => {
  it('chart of account transactions uses accounttransactions', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', transactions: [] })]);
    await testClient(m.fetch).chartOfAccounts.listTransactions({ account_id: 'a' });
    expect(m.calls[0]!.url.pathname).toBe('/books/v3/chartofaccounts/accounttransactions');
  });
});

describe('methods Zoho does not have', () => {
  it('are rejected at compile time and at runtime', async () => {
    const m = mockFetch();
    const books = testClient(m.fetch);
    // @ts-expect-error bills have no email endpoint
    await expect(books.bills.email('1', { to_mail_ids: [] })).rejects.toBeInstanceOf(ZohoConfigError);
    // @ts-expect-error credit notes have no bulk PDF endpoint
    await expect(books.creditNotes.bulkPdf(['1'])).rejects.toThrow(/no bulkPdf endpoint for creditnotes/);
    // @ts-expect-error delivery challans have no submit endpoint
    await expect(books.deliveryChallans.submit('1')).rejects.toBeInstanceOf(ZohoConfigError);
    // @ts-expect-error locations have no get endpoint
    await expect(books.locations.get('1')).rejects.toBeInstanceOf(ZohoConfigError);
    expect(m.calls).toHaveLength(0);
  });

  it('supported ones still work', async () => {
    const m = mockFetch().on('POST', /.*/, () => json({ code: 0, message: 'ok' }));
    const books = testClient(m.fetch);
    await books.bills.submit('1');
    await books.deliveryChallans.addAttachment('1', new Uint8Array([1]), 'a.pdf');
    expect(m.calls.map((c) => c.url.pathname)).toEqual(['/books/v3/bills/1/submit', '/books/v3/deliverychallans/1/attachment']);
  });
});

describe('typos in filters and inputs', () => {
  it('fail to compile while custom field filters stay allowed', () => {
    const books = testClient(mockFetch().fetch);
    const typecheckOnly = () => {
      // @ts-expect-error misspelled filter
      void books.invoices.list({ stauts: 'paid' });
      // @ts-expect-error misspelled input field
      void books.invoices.create({ customer_id: '1', line_item: [] });
      void books.invoices.list({ status: 'paid', cf_order_id: 'ORD-1' });
    };
    expect(typeof typecheckOnly).toBe('function');
  });
});

describe('rate limiter per organization', () => {
  it('withOrganization reuses one client per org', () => {
    const books = testClient(mockFetch().fetch);
    const a = books.withOrganization('777');
    expect(books.withOrganization('777')).toBe(a);
    expect(a.http).toBe(books.withOrganization('777').http);
    expect(books.withOrganization(books.organizationId!)).toBe(books);
  });

  it('pause holds queued requests', async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 100, maxConcurrent: 10 });
    limiter.pause(60);
    const t0 = Date.now();
    await limiter.schedule(async () => undefined);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });
});

describe('abort', () => {
  it('stops a request waiting in rate limit back off', async () => {
    const m = mockFetch().on('GET', /.*/, () => json({ code: 44, message: 'Too many requests' }, 429));
    const books = new ZohoBooks({
      accessToken: 't',
      organizationId: '1',
      fetch: m.fetch,
      rateLimit: false,
      retry: { rateLimitDelayMs: 10_000 },
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('cancelled')), 20);
    const t0 = Date.now();
    await expect(books.invoices.get('1', { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(m.calls).toHaveLength(1);
  });

  it('removes a request queued in the limiter', async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 100, maxConcurrent: 1 });
    let release!: () => void;
    const first = limiter.schedule(() => new Promise<void>((r) => (release = r)));
    const controller = new AbortController();
    let ran = false;
    const second = limiter.schedule(async () => void (ran = true), controller.signal);
    controller.abort(new Error('gone'));
    await expect(second).rejects.toThrow('gone');
    release();
    await first;
    expect(ran).toBe(false);
  });
});

describe('GST helper picks up new taxes', () => {
  it('reloads taxes once when a rate is missing', async () => {
    let taxCalls = 0;
    const m = mockFetch()
      .on('GET', '/organizations/600000001', () => json({ code: 0, message: 'ok', organization: { organization_id: '1', name: 'x', address: { state: 'KA' } } }))
      .on('GET', '/settings/taxes', () => {
        taxCalls++;
        const taxes = [{ tax_id: 'igst18', tax_name: 'IGST18', tax_percentage: 18, tax_specific_type: 'igst' }];
        if (taxCalls > 1) taxes.push({ tax_id: 'igst40', tax_name: 'IGST40', tax_percentage: 40, tax_specific_type: 'igst' });
        return json({ code: 0, message: 'ok', taxes, page_context: { page: 1, per_page: 200, has_more_page: false } });
      })
      .on('GET', /\/contacts\/.+/, () => json({ code: 0, message: 'ok', contact: { contact_id: 'c', gst_treatment: 'consumer', place_of_contact: 'MH' } }));
    const books = testClient(m.fetch);
    await books.gst.prepareInvoice({ customer_id: 'c', line_items: [{ rate: 1, quantity: 1, gstRate: 18 }] });
    const res = await books.gst.prepareInvoice({ customer_id: 'c', line_items: [{ rate: 1, quantity: 1, gstRate: 40 }] });
    expect(res.payload.line_items![0]!.tax_id).toBe('igst40');
    expect(taxCalls).toBe(2);
  });
});

describe('user agent', () => {
  it('carries the package version', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    const m = mockFetch([json({ code: 0, message: 'ok', contacts: [] })]);
    await testClient(m.fetch).contacts.list();
    expect(m.calls[0]!.headers['user-agent']).toBe(`zoho-books-sdk-node/${version}`);
  });
});
