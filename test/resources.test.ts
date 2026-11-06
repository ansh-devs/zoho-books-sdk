import { describe, expect, it } from 'vitest';
import { RateLimiter, extractList, extractOne } from '../src/index.js';
import { json, mockFetch, testClient } from './helpers.js';

describe('pagination', () => {
  it('iterates every page until has_more_page is false', async () => {
    const m = mockFetch()
      .on('GET', '/invoices', (call) => {
        const page = Number(call.url.searchParams.get('page'));
        const items = page === 1 ? [{ invoice_id: '1' }, { invoice_id: '2' }] : [{ invoice_id: '3' }];
        return json({ code: 0, message: 'ok', invoices: items, page_context: { page, per_page: 2, has_more_page: page === 1 } });
      });
    const books = testClient(m.fetch);
    const ids: string[] = [];
    for await (const inv of books.invoices.iterate({ status: 'unpaid' }, { pageSize: 2 })) ids.push(inv.invoice_id);
    expect(ids).toEqual(['1', '2', '3']);
    expect(m.calls.map((c) => c.url.searchParams.get('page'))).toEqual(['1', '2']);
    expect(m.calls[0]!.url.searchParams.get('per_page')).toBe('2');
    expect(m.calls[0]!.url.searchParams.get('status')).toBe('unpaid');
  });

  it('respects limit and stops fetching', async () => {
    const m = mockFetch().on('GET', '/contacts', (call) =>
      json({
        code: 0,
        message: 'ok',
        contacts: [{ contact_id: `${call.url.searchParams.get('page')}a` }, { contact_id: `${call.url.searchParams.get('page')}b` }],
        page_context: { page: 1, per_page: 2, has_more_page: true },
      }),
    );
    const all = await testClient(m.fetch).contacts.listAll({}, { limit: 3, pageSize: 2 });
    expect(all.map((c) => c.contact_id)).toEqual(['1a', '1b', '2a']);
    expect(m.calls).toHaveLength(2);
  });

  it('list() returns items + page context', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', items: [{ item_id: 'i' }], page_context: { page: 1, per_page: 200, has_more_page: false } })]);
    const res = await testClient(m.fetch).items.list();
    expect(res.items).toHaveLength(1);
    expect(res.hasMore).toBe(false);
  });
});

describe('response key drift tolerance', () => {
  it('extractList falls back to aliases and then to any array', () => {
    expect(extractList({ code: 0, customer_payments: [1] }, ['customerpayments', 'customer_payments'])).toEqual([1]);
    expect(extractList({ code: 0, message: 'x', whatever: [2], page_context: {} }, ['nope'])).toEqual([2]);
  });
  it('extractOne returns the flattened envelope only when the resource is flat', () => {
    const flat = { code: 0, message: 'ok', account_id: 'a', account_name: 'Cash' };
    expect(extractOne(flat, ['chart_of_account'], true)).toEqual({ account_id: 'a', account_name: 'Cash' });
    expect(() => extractOne(flat, ['invoice'])).toThrow(/no "invoice" record/);
    expect(extractOne({ code: 0, message: 'ok', invoice_v2: { invoice_id: '1' } }, ['invoice'])).toEqual({ invoice_id: '1' });
  });

  it('chart of accounts reads the flat record', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', account_id: 'a', account_name: 'Cash' })]);
    const acc = await testClient(m.fetch).chartOfAccounts.get('a');
    expect(acc.account_name).toBe('Cash');
  });
  it('customer payments list works with either key', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', customerpayments: [{ payment_id: 'p1' }] })]);
    const res = await testClient(m.fetch).customerPayments.list();
    expect(res.items[0]!.payment_id).toBe('p1');
  });
});

describe('invoices', () => {
  it('create maps typed flags to query params', async () => {
    const m = mockFetch([json({ code: 0, message: 'The invoice has been created.', invoice: { invoice_id: '9', invoice_number: 'INV-9', status: 'sent' } })]);
    const inv = await testClient(m.fetch).invoices.create(
      { customer_id: 'c1', invoice_number: 'INV-9', line_items: [{ item_id: 'i1', quantity: 1, rate: 10 }] },
      { send: true, ignoreAutoNumberGeneration: true },
    );
    expect(inv.invoice_number).toBe('INV-9');
    const call = m.calls[0]!;
    expect(call.method).toBe('POST');
    expect(call.url.searchParams.get('send')).toBe('true');
    expect(call.url.searchParams.get('ignore_auto_number_generation')).toBe('true');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toMatchObject({ customer_id: 'c1', invoice_number: 'INV-9' });
  });

  it('status actions hit the documented paths', async () => {
    const m = mockFetch().on('POST', /.*/, () => json({ code: 0, message: 'done' }));
    const books = testClient(m.fetch);
    await books.invoices.markSent('1');
    await books.invoices.markVoid('1');
    await books.invoices.writeOff('1');
    await books.invoices.submit('1');
    await books.invoices.approve('1');
    expect(m.calls.map((c) => c.url.pathname.replace('/books/v3', ''))).toEqual([
      '/invoices/1/status/sent',
      '/invoices/1/status/void',
      '/invoices/1/writeoff',
      '/invoices/1/submit',
      '/invoices/1/approve',
    ]);
  });

  it('emailMany chunks into groups of 10', async () => {
    const m = mockFetch().on('POST', '/invoices/email', () => json({ code: 0, message: 'sent' }));
    const ids = Array.from({ length: 23 }, (_, i) => String(i));
    const res = await testClient(m.fetch).invoices.emailMany(ids);
    expect(res).toHaveLength(3);
    expect(m.calls.map((c) => c.url.searchParams.get('invoice_ids')!.split(',').length)).toEqual([10, 10, 3]);
  });

  it('upsertByCustomField sends the unique-identifier headers', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', invoice: { invoice_id: '5' } })]);
    await testClient(m.fetch).invoices.upsertByCustomField('cf_order_id', 'ORD-42', { customer_id: 'c' }, { upsert: true });
    const call = m.calls[0]!;
    expect(call.method).toBe('PUT');
    expect(call.url.pathname).toBe('/books/v3/invoices');
    expect(call.headers['x-unique-identifier-key']).toBe('cf_order_id');
    expect(call.headers['x-unique-identifier-value']).toBe('ORD-42');
    expect(call.headers['x-upsert']).toBe('true');
  });

  it('addAttachment uploads multipart', async () => {
    const m = mockFetch([json({ code: 0, message: 'Your file has been successfully attached to the invoice.' })]);
    await testClient(m.fetch).invoices.addAttachment('1', new Uint8Array([1, 2, 3]), 'po.pdf', { contentType: 'application/pdf', canSendInEmail: true });
    const call = m.calls[0]!;
    expect(call.rawBody).toBeInstanceOf(FormData);
    expect((call.rawBody as FormData).get('attachment')).toBeInstanceOf(Blob);
    expect(call.url.searchParams.get('can_send_in_mail')).toBe('true');
  });

  it('e-invoice endpoints', async () => {
    const m = mockFetch().on('POST', /.*/, () => json({ code: 0, message: 'ok' })).on('GET', /.*/, () =>
      json({ code: 0, message: 'ok', einvoice: { inv_ref_num: 'IRN123', ack_no: '1', status: 'pushed' } }),
    );
    const books = testClient(m.fetch);
    await books.invoices.einvoice.push('1');
    await books.invoices.einvoice.cancel('1', { reason: '2', remarks: 'Data entry mistake' });
    await books.invoices.einvoice.pushMany(['1', '2']);
    const details = await books.invoices.einvoice.get('1');
    await books.creditNotes.einvoice.push('cn1');
    expect(details.inv_ref_num).toBe('IRN123');
    const paths = m.calls.map((c) => c.url.pathname.replace('/books/v3', ''));
    expect(paths).toEqual([
      '/invoices/1/einvoice/push',
      '/invoices/1/einvoice/cancel',
      '/invoices/einvoice/push',
      '/invoices/1/einvoice',
      '/creditnotes/cn1/einvoice/push',
    ]);
    expect(m.calls[1]!.body).toEqual({ reason: '2', remarks: 'Data entry mistake' });
    expect(m.calls[2]!.url.searchParams.get('invoice_ids')).toBe('1,2');
  });
});

describe('other resources', () => {
  it('debit notes add type=debit_note', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', debit_notes: [] }), json({ code: 0, message: 'ok', invoice: { invoice_id: 'd' } })]);
    const books = testClient(m.fetch);
    await books.debitNotes.list();
    await books.debitNotes.create({ customer_id: 'c' });
    expect(m.calls[0]!.url.searchParams.get('type')).toBe('debit_note');
    expect(m.calls[1]!.body).toMatchObject({ type: 'debit_note' });
  });

  it('taxes live under /settings', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', taxes: [] }), json({ code: 0, message: 'ok', tax_group: { tax_group_id: 'g' } })]);
    const books = testClient(m.fetch);
    await books.taxes.list();
    await books.taxes.groups.get('g');
    expect(m.calls.map((c) => c.url.pathname)).toEqual(['/books/v3/settings/taxes', '/books/v3/settings/taxgroups/g']);
  });

  it('withOrganization targets another org with the same auth', async () => {
    const m = mockFetch().on('GET', /.*/, () => json({ code: 0, message: 'ok', contacts: [] }));
    const books = testClient(m.fetch);
    const other = books.withOrganization('777');
    other.http.sleep = async () => {};
    await other.contacts.list();
    await books.contacts.list({}, { organizationId: '888' });
    expect(m.calls[0]!.url.searchParams.get('organization_id')).toBe('777');
    expect(m.calls[1]!.url.searchParams.get('organization_id')).toBe('888');
    expect(other.auth).toBe(books.auth);
  });

  it('request() escape hatch', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', data: { x: 1 } })]);
    const res = await testClient(m.fetch).request<{ data: { x: number } }>({ method: 'GET', path: '/invoices/dashboard' });
    expect(res.data.x).toBe(1);
  });

  it('encodes path ids', async () => {
    const m = mockFetch([json({ code: 0, message: 'ok', contact: {} })]);
    await testClient(m.fetch).contacts.get('a/b');
    expect(m.calls[0]!.url.pathname).toBe('/books/v3/contacts/a%2Fb');
  });
});

describe('RateLimiter', () => {
  it('caps concurrency', async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 1000, maxConcurrent: 2 });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.schedule(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('enforces requests per window', async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 3, maxConcurrent: 10, windowMs: 60 });
    const started: number[] = [];
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => limiter.schedule(async () => void started.push(Date.now() - t0))));
    expect(started.filter((t) => t < 40)).toHaveLength(3);
    expect(Math.max(...started)).toBeGreaterThanOrEqual(50);
  });
});
