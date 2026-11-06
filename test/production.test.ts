import { describe, expect, it } from 'vitest';
import {
  InvoiceWorkflow,
  RefreshTokenAuth,
  ZohoOAuth,
  cacheTokenStore,
  findState,
  isRetiredStateCode,
  nextRetryAt,
  parseGstin,
  settle,
  stateFromGstin,
  toPlaceOfSupply,
  toZohoDate,
  validateBillingProfile,
  type InvoiceOrder,
  type KeyValueCache,
  type WorkflowState,
} from '../src/index.js';
import { json, mockFetch, testClient, type RecordedCall } from './helpers.js';

const B2B_GSTIN = '27AAPFU0939F1ZV'; // Maharashtra

describe('Zoho state codes', () => {
  it('uses AD for Andhra Pradesh and UK for Uttarakhand', () => {
    expect(toPlaceOfSupply('37')).toBe('AD');
    expect(toPlaceOfSupply('AP')).toBe('AD');
    expect(toPlaceOfSupply('Andhra Pradesh')).toBe('AD');
    expect(toPlaceOfSupply('05')).toBe('UK');
    expect(toPlaceOfSupply('UT')).toBe('UK');
  });

  it('accepts the GST prefix or the letter code', () => {
    expect(findState('23')?.code).toBe('MP');
    expect(findState('MP')?.gstCode).toBe('23');
    expect(findState('AD')?.gstCode).toBe('37');
  });

  it('refuses retired codes for new data but accepts them on old GSTINs', () => {
    for (const code of ['25', '28', 'DD']) {
      expect(isRetiredStateCode(code)).toBe(true);
      expect(toPlaceOfSupply(code)).toBeUndefined();
    }
    expect(stateFromGstin('28AAAAA0000A1Z5')?.code).toBe('AD');
    expect(stateFromGstin('25AAAAA0000A1Z5')?.code).toBe('DN');
  });
});

describe('GSTIN check digit', () => {
  it('catches transposed characters the format check alone accepts', () => {
    expect(parseGstin(B2B_GSTIN).valid).toBe(true);
    const transposed = '27AAPFU0399F1ZV'; // 0939 written as 0399
    expect(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(transposed)).toBe(true);
    expect(parseGstin(transposed).valid).toBe(false);
  });
});

describe('dates in India time', () => {
  it('dates a payment just after midnight IST on the IST day', () => {
    expect(toZohoDate(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11-01');
    expect(toZohoDate(new Date('2026-10-31T18:29:59Z'))).toBe('2026-10-31');
  });
});

describe('billing profile validation', () => {
  it('requires full Rule 46 details for a business', () => {
    expect(validateBillingProfile({ kind: 'business', legalName: 'Acme' })).toEqual(
      expect.arrayContaining(['address is required', 'city is required', 'pin is required', 'state is required']),
    );
  });
  it('rejects a GSTIN from another state and a GSTIN on a consumer', () => {
    const base = { legalName: 'Acme', address: '1 Road', city: 'Pune', pin: '411001' };
    expect(validateBillingProfile({ ...base, kind: 'business', gstin: B2B_GSTIN, state: 'KA' })).toEqual([
      'gstin belongs to Maharashtra, but state is Karnataka',
    ]);
    expect(validateBillingProfile({ ...base, kind: 'consumer', gstin: B2B_GSTIN })).toContain('gstin is only allowed on a business profile');
  });
  it('needs a country other than India for overseas', () => {
    expect(validateBillingProfile({ kind: 'overseas', legalName: 'X', country: 'India' })).toContain(
      'an overseas profile needs a country other than India',
    );
  });
});

describe('retry schedule', () => {
  it('backs off 2, 10, 60, 360, 1440 minutes, then stops', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    expect([1, 2, 3, 4, 5].map((n) => (nextRetryAt(n, now)!.getTime() - now.getTime()) / 60_000)).toEqual([2, 10, 60, 360, 1440]);
    expect(nextRetryAt(6, now)).toBeUndefined();
  });
});

describe('settle', () => {
  it('returns data on success and a code on failure, never throwing', async () => {
    expect(await settle(Promise.resolve(1))).toEqual({ success: true, data: 1 });
    const books = testClient(mockFetch([json({ code: 1002, message: 'Invoice does not exist.' }, 200)]).fetch);
    const res = await settle(books.invoices.get('1'));
    expect(res).toMatchObject({ success: false, code: 'ZOHO_1002', data: { code: 1002 } });
  });

  it('labels rate limits, missing records and bad credentials', async () => {
    const limited = await settle(testClient(mockFetch([json({ code: 1070, message: 'busy' }, 429)]).fetch, { retry: { maxRetries: 0 } }).contacts.list());
    expect(limited.success ? '' : limited.code).toBe('RATE_LIMITED');
    const noId = await settle(testClient(mockFetch([json({ code: 0, message: 'ok' })]).fetch).invoices.get('1'));
    expect(noId.success ? '' : noId.code).toBe('ZOHO_NO_ID');
    const oauth = new ZohoOAuth({ clientId: 'c', clientSecret: 's', fetch: mockFetch([json({ error: 'invalid_client' })]).fetch });
    const bad = await settle(oauth.refresh('r'));
    expect(bad.success ? '' : bad.code).toBe('INVALID_CREDENTIALS');
    expect(bad.success ? '' : bad.error.message).toMatch(/Multi DC/);
  });
});

describe('multi data center OAuth', () => {
  it('reads location and accounts-server from the callback and exchanges there', async () => {
    const cb = ZohoOAuth.parseCallback('https://app/cb?code=abc&state=s&location=eu&accounts-server=https%3A%2F%2Faccounts.zoho.eu');
    expect(cb).toMatchObject({ code: 'abc', state: 's', location: 'eu', accountsServer: 'https://accounts.zoho.eu' });
    const m = mockFetch([json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })]);
    const oauth = new ZohoOAuth({ clientId: 'c', clientSecret: 's', dataCenter: 'in', fetch: m.fetch, allowedDataCenters: ['in', 'eu'] });
    const tokens = await oauth.exchangeCode(cb.code!, 'https://app/cb', cb);
    expect(m.calls[0]!.url.origin).toBe('https://accounts.zoho.eu');
    expect(tokens.dataCenter).toBe('eu');
  });

  it('refuses a data center the client does not allow, and unknown hosts', async () => {
    const oauth = new ZohoOAuth({ clientId: 'c', clientSecret: 's', dataCenter: 'in', fetch: mockFetch().fetch, allowedDataCenters: ['in'] });
    await expect(oauth.exchangeCode('x', undefined, { accountsServer: 'https://accounts.zoho.com' })).rejects.toThrow(/us data center.*Multi DC/);
    await expect(oauth.exchangeCode('x', undefined, { accountsServer: 'https://accounts.evil.com' })).rejects.toThrow(/Unknown Zoho accounts server/);
  });
});

/** In memory KeyValueCache, optionally broken to simulate an outage. */
function memoryCache(broken = false) {
  const data = new Map<string, string>();
  const fail = () => {
    if (broken) throw new Error('cache down');
  };
  const cache: KeyValueCache = {
    async get(k) {
      fail();
      return data.get(k);
    },
    async set(k, v) {
      fail();
      data.set(k, v);
    },
    async setIfAbsent(k, v) {
      fail();
      if (data.has(k)) return false;
      data.set(k, v);
      return true;
    },
    async delete(k) {
      fail();
      data.delete(k);
    },
  };
  return { cache, data };
}

describe('refresh lock across processes', () => {
  it('lets one process refresh while others wait and reuse its token', async () => {
    let refreshes = 0;
    const m = mockFetch().on('POST', '/oauth/v2/token', async () => {
      refreshes++;
      await new Promise((r) => setTimeout(r, 30));
      return json({ access_token: 'shared', expires_in: 3600 });
    });
    const { cache } = memoryCache();
    const store = () => cacheTokenStore(cache, { pollIntervalMs: 10, pollAttempts: 20 });
    const opts = { clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: m.fetch };
    const a = new RefreshTokenAuth({ ...opts, tokenStore: store() });
    const b = new RefreshTokenAuth({ ...opts, tokenStore: store() });
    expect(await Promise.all([a.getAccessToken(), b.getAccessToken()])).toEqual(['shared', 'shared']);
    expect(refreshes).toBe(1);
  });

  it('refreshes anyway when the cache is down', async () => {
    const m = mockFetch([json({ access_token: 'direct', expires_in: 3600 })]);
    const auth = new RefreshTokenAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: m.fetch, tokenStore: cacheTokenStore(memoryCache(true).cache) });
    expect(await auth.getAccessToken()).toBe('direct');
  });

  it('takes over when the lock holder never finishes', async () => {
    const m = mockFetch([json({ access_token: 'mine', expires_in: 3600 })]);
    const { cache, data } = memoryCache();
    const store = cacheTokenStore(cache, { pollIntervalMs: 1, pollAttempts: 3 });
    const auth = new RefreshTokenAuth({ clientId: 'c', clientSecret: 's', refreshToken: 'r', fetch: m.fetch, tokenStore: store, tokenStoreKey: 'k' });
    data.set('k:lock', '1'); // a crashed holder
    expect(await auth.getAccessToken()).toBe('mine');
  });
});

const TAXES = [
  { tax_id: 'igst18', tax_name: 'IGST18', tax_percentage: 18, tax_specific_type: 'igst' },
  { tax_id: 'gst18', tax_name: 'GST18', tax_percentage: 18, tax_type: 'tax_group' },
  { tax_id: 'igst0', tax_name: 'IGST0', tax_percentage: 0, tax_specific_type: 'igst' },
];

interface FakeOptions {
  invoices?: Array<Record<string, unknown>>;
  contacts?: Array<Record<string, unknown>>;
  total?: number;
  status?: string;
  push?: () => Response;
  email?: () => Response;
}

/** Fake Zoho org in Maharashtra that records every call. */
function fakeZoho(o: FakeOptions = {}) {
  const m = mockFetch()
    .on('GET', /\/organizations\/\w+$/, () => json({ code: 0, message: 'ok', organization: { organization_id: '1', name: 'Org', address: { state: 'Maharashtra' } } }))
    .on('GET', /\/settings\/taxes$/, () => json({ code: 0, message: 'ok', taxes: TAXES, page_context: { page: 1, per_page: 200, has_more_page: false } }))
    .on('GET', /\/contacts$/, () => json({ code: 0, message: 'ok', contacts: o.contacts ?? [], page_context: { page: 1, per_page: 200, has_more_page: false } }))
    .on('PUT', /\/contacts\/\w+$/, (c) => json({ code: 0, message: 'ok', contact: { contact_id: c.url.pathname.split('/').pop() } }))
    .on('POST', /\/contacts$/, () => json({ code: 0, message: 'ok', contact: { contact_id: 'newc' } }))
    .on('GET', /\/invoices$/, () => json({ code: 0, message: 'ok', invoices: o.invoices ?? [], page_context: { page: 1, per_page: 200, has_more_page: false } }))
    .on('GET', /\/invoices\/\w+$/, (c) =>
      json({ code: 0, message: 'ok', invoice: { invoice_id: c.url.pathname.split('/').pop(), total: o.total ?? 1180, status: o.status ?? 'draft' } }),
    )
    .on('POST', /\/invoices$/, (c) => json({ code: 0, message: 'ok', invoice: { invoice_id: 'newi', total: o.total ?? 1180, status: 'draft', ...(c.body as object) } }))
    .on('POST', /\/customerpayments$/, () => json({ code: 0, message: 'ok', payment: { payment_id: 'newp' } }))
    .on('POST', /\/einvoice\/push$/, () => (o.push ? o.push() : json({ code: 0, message: 'pushed' })))
    .on('POST', /\/invoices\/\w+\/email$/, () => (o.email ? o.email() : json({ code: 0, message: 'sent' })));
  return { m, books: testClient(m.fetch, { organizationId: '1' }) };
}

const order = (over: Partial<InvoiceOrder> = {}): InvoiceOrder => ({
  reference: 'ORD-1',
  paidAt: new Date('2026-10-31T19:00:00Z'),
  currency: 'INR',
  profile: { kind: 'business', legalName: 'Acme', email: 'a@acme.in', gstin: B2B_GSTIN, address: '1 Road', city: 'Pune', state: 'MH', pin: '411001' },
  lines: [{ name: 'Credits', quantity: 1, unitAmountMinor: 100000, gstRate: 18, hsnOrSac: '998314' }],
  capturedMinor: 118000,
  payment: { reference: 'pay_1', mode: 'creditcard', depositAccountId: 'acc1' },
  ...over,
});

const paths = (calls: RecordedCall[]) => calls.map((c) => `${c.method} ${c.url.pathname.replace('/books/v3', '')}`);

describe('invoice workflow', () => {
  it('runs contact, invoice, payment, IRP push and email, saving after each step', async () => {
    const { m, books } = fakeZoho();
    const saved: WorkflowState[] = [];
    const out = await new InvoiceWorkflow(books, { einvoicing: true, save: (s) => void saved.push(s) }).run(order());
    expect(out.status).toBe('done');
    expect(out.state).toEqual({ contactId: 'newc', invoiceId: 'newi', paymentId: 'newp', einvoicePushed: true, emailed: true });
    expect(saved).toHaveLength(5);
    const p = paths(m.calls);
    expect(p.indexOf('POST /customerpayments')).toBeLessThan(p.indexOf('POST /invoices/newi/einvoice/push'));
    const inv = m.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/invoices'))!.body as Record<string, unknown>;
    expect(inv).toMatchObject({ date: '2026-11-01', reference_number: 'ORD-1', place_of_supply: 'MH', gst_treatment: 'business_gst' });
    expect((inv.line_items as Array<Record<string, unknown>>)[0]).toMatchObject({ tax_group_id: 'gst18', rate: 1000 });
    const pay = m.calls.find((c) => c.url.pathname.endsWith('/customerpayments'))!.body;
    expect(pay).toMatchObject({ amount: 1180, date: '2026-11-01', account_id: 'acc1', invoices: [{ invoice_id: 'newi', amount_applied: 1180 }] });
  });

  it('does not push consumer invoices', async () => {
    const { m, books } = fakeZoho();
    const profile = { kind: 'consumer' as const, legalName: 'Ravi', email: 'r@x.in', systemGenerated: true };
    const out = await new InvoiceWorkflow(books, { einvoicing: true, save: () => {} }).run(order({ profile }));
    expect(out.status).toBe('done');
    expect(paths(m.calls).some((p) => p.includes('einvoice'))).toBe(false);
  });

  it('settles a rounding gap at Zoho total, but records nothing on a real mismatch', async () => {
    const small = fakeZoho({ total: 1180.04 });
    expect((await new InvoiceWorkflow(small.books, { save: () => {} }).run(order())).status).toBe('done');
    expect(small.m.calls.find((c) => c.url.pathname.endsWith('/customerpayments'))!.body).toMatchObject({ amount: 1180.04 });

    const big = fakeZoho({ total: 1181 });
    const out = await new InvoiceWorkflow(big.books, { save: () => {} }).run(order());
    expect(out.status).toBe('review');
    expect(big.m.calls.some((c) => c.url.pathname.endsWith('/customerpayments'))).toBe(false);
  });

  it('finishes a refused second push when the email goes through', async () => {
    const { books } = fakeZoho({ push: () => json({ code: 1001, message: 'Already pushed' }, 400) });
    const out = await new InvoiceWorkflow(books, { einvoicing: true, save: () => {} }).run(order());
    expect(out).toMatchObject({ status: 'done', state: { einvoicePushed: true, emailed: true } });
  });

  it('reports the push error when the email also fails, and keeps retrying without an email', async () => {
    const both = fakeZoho({
      push: () => json({ code: 1001, message: 'Push refused' }, 400),
      email: () => json({ code: 2051, message: 'has not been e-Invoiced. Push it to the IRP to proceed' }, 400),
    });
    const out = await new InvoiceWorkflow(both.books, { einvoicing: true, save: () => {} }).run(order());
    expect(out.status).toBe('retry');
    expect(String((out as { error: Error }).error.message)).toMatch(/Push refused/);

    const noEmail = fakeZoho({ push: () => json({ code: 1001, message: 'Push refused' }, 400) });
    const profile = { ...order().profile, email: undefined };
    expect((await new InvoiceWorkflow(noEmail.books, { einvoicing: true, save: () => {} }).run(order({ profile }))).status).toBe('retry');
  });

  it('returns rate_limited, which must not count as an attempt', async () => {
    const { books } = fakeZoho({ push: () => json({ code: 44, message: 'Too many requests' }, 429) });
    books.http.sleep = async () => {};
    const out = await new InvoiceWorkflow(books, { einvoicing: true, save: () => {} }).run(order());
    expect(out.status).toBe('rate_limited');
  });

  it('adopts only an exact reference match and resumes from saved ids', async () => {
    const { m, books } = fakeZoho({ invoices: [{ invoice_id: 'partial', reference_number: 'ORD-10' }, { invoice_id: 'exact', reference_number: 'ORD-1' }] });
    const out = await new InvoiceWorkflow(books, { save: () => {} }).run(order(), { contactId: 'c9' });
    expect(out.state.invoiceId).toBe('exact');
    expect(paths(m.calls)).not.toContain('POST /invoices');
    expect(paths(m.calls)).not.toContain('POST /contacts');
  });

  it('skips the payment when the adopted invoice is already paid', async () => {
    const { m, books } = fakeZoho({ status: 'paid' });
    await new InvoiceWorkflow(books, { save: () => {} }).run(order(), { contactId: 'c', invoiceId: 'i' });
    expect(paths(m.calls)).not.toContain('POST /customerpayments');
  });

  it('updates a contact adopted by email with the current GST details', async () => {
    const { m, books } = fakeZoho({ contacts: [{ contact_id: 'old', email: 'a@acme.in' }] });
    await new InvoiceWorkflow(books, { save: () => {} }).run(order());
    const put = m.calls.find((c) => c.method === 'PUT')!;
    expect(put.url.pathname).toBe('/books/v3/contacts/old');
    expect(put.body).toMatchObject({ gst_treatment: 'business_gst', gst_no: B2B_GSTIN, place_of_contact: 'MH' });
  });

  it('never adopts a contact by email for a system generated consumer', async () => {
    const { m, books } = fakeZoho({ contacts: [{ contact_id: 'accountant', email: 'r@x.in', gst_no: B2B_GSTIN }] });
    const profile = { kind: 'consumer' as const, legalName: 'Ravi', email: 'r@x.in', systemGenerated: true };
    const out = await new InvoiceWorkflow(books, { save: () => {} }).run(order({ profile }));
    expect(out.state.contactId).toBe('newc');
    expect(m.calls.some((c) => c.method === 'GET' && c.url.pathname.endsWith('/contacts'))).toBe(false);
  });

  it('holds non INR, overseas without an export mode, invalid profiles and custom rules', async () => {
    const { m, books } = fakeZoho();
    const wf = new InvoiceWorkflow(books, { save: () => {}, holdRules: [(o) => (o.reference === 'X' ? 'unknown product' : undefined)] });
    expect(await wf.run(order({ currency: 'USD' }))).toMatchObject({ status: 'held', reason: 'Currency USD is not INR' });
    expect((await wf.run(order({ profile: { kind: 'overseas', legalName: 'Bob', country: 'US' } }))).status).toBe('held');
    expect((await wf.run(order({ profile: { kind: 'business', legalName: 'Acme' } }))).status).toBe('held');
    expect(await wf.run(order({ reference: 'X' }))).toMatchObject({ status: 'held', reason: 'unknown product' });
    expect(m.calls).toHaveLength(0);
  });

  it('zero rates overseas supplies under an LUT', async () => {
    const { m, books } = fakeZoho({ total: 1000 });
    const out = await new InvoiceWorkflow(books, { exportMode: 'lut', save: () => {} }).run(
      order({ profile: { kind: 'overseas', legalName: 'Bob', country: 'United States' }, capturedMinor: 100000 }),
    );
    expect(out.status).toBe('done');
    const inv = m.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/invoices'))!.body as Record<string, unknown>;
    expect((inv.line_items as Array<Record<string, unknown>>)[0]).toMatchObject({ tax_id: 'igst0' });
  });
});

describe('GST helper rules from production', () => {
  function setup(contact: Record<string, unknown>) {
    const { books } = fakeZoho();
    return { books, contact: { contact_id: 'c', contact_name: 'x', ...contact } };
  }
  it('rejects a GSTIN on a consumer invoice', async () => {
    const { books, contact } = setup({ gst_treatment: 'consumer', gst_no: B2B_GSTIN });
    await expect(books.gst.prepareInvoice({ customer_id: 'c', line_items: [] }, { contact })).rejects.toThrow(/not allowed/);
  });
  it('rejects a place of supply that does not match the GSTIN state', async () => {
    const { books, contact } = setup({ gst_treatment: 'business_gst', gst_no: B2B_GSTIN });
    await expect(books.gst.prepareInvoice({ customer_id: 'c', place_of_supply: 'KA', line_items: [] }, { contact })).rejects.toThrow(/does not match/);
  });
  it('requires an explicit export mode for overseas', async () => {
    const { books, contact } = setup({ gst_treatment: 'overseas' });
    await expect(books.gst.prepareInvoice({ customer_id: 'c', line_items: [{ rate: 1, quantity: 1, gstRate: 18 }] }, { contact })).rejects.toThrow(/exportMode/);
  });
  it('puts a consumer with no address in the supplier state', async () => {
    const { books, contact } = setup({ gst_treatment: 'consumer' });
    const res = await books.gst.prepareInvoice({ customer_id: 'c', line_items: [{ rate: 1, quantity: 1, gstRate: 18 }] }, { contact });
    expect(res.placeOfSupply).toBe('MH');
    expect(res.payload.line_items![0]).toMatchObject({ tax_group_id: 'gst18' });
  });
});
