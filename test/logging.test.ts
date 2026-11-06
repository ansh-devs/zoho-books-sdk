import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InvoiceWorkflow, ZohoBooks, createSdkLogger, redact, type LoggingOptions, type ZohoBooksOptions } from '../src/index.js';
import { json, mockFetch } from './helpers.js';

// The suite silences SDK logs through this variable; these tests check the real defaults.
const savedLevel = process.env.ZOHO_BOOKS_LOG_LEVEL;
beforeAll(() => {
  delete process.env.ZOHO_BOOKS_LOG_LEVEL;
});
afterAll(() => {
  process.env.ZOHO_BOOKS_LOG_LEVEL = savedLevel;
});

/** Client using the built in JSON logger, writing into an array. */
function setup(replies: Parameters<typeof mockFetch>[0], logging: LoggingOptions = {}, over: Partial<ZohoBooksOptions> = {}) {
  const lines: string[] = [];
  const m = mockFetch(replies);
  const books = new ZohoBooks({
    accessToken: '1000.SECRET_ACCESS',
    organizationId: '600000001',
    dataCenter: 'in',
    fetch: m.fetch,
    rateLimit: false,
    retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2, rateLimitDelayMs: 1 },
    logging: { destination: { write: (s: string) => lines.push(s) }, ...logging },
    ...over,
  });
  books.http.sleep = async () => {};
  const events = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { m, books, lines, events };
}

/** Records calls in Pino's fields then message order. */
function fakePino(level = 'info') {
  const calls: Array<{ level: string; fields: Record<string, unknown>; msg?: string }> = [];
  const make = (bindings: Record<string, unknown>): Record<string, unknown> => {
    const log = (lvl: string) => (fields: Record<string, unknown>, msg?: string) => calls.push({ level: lvl, fields: { ...bindings, ...fields }, ...(msg !== undefined ? { msg } : {}) });
    return {
      level,
      levels: { values: { info: 30 } },
      bindings: () => bindings,
      trace: log('trace'),
      debug: log('debug'),
      info: log('info'),
      warn: log('warn'),
      error: log('error'),
      child: (b: Record<string, unknown>) => make({ ...bindings, ...b }),
    };
  };
  return { pino: make({}), calls };
}

describe('built in logger defaults', () => {
  it('is quiet on success and writes Pino compatible JSON for failures', async () => {
    const { books, events } = setup([
      json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } }),
      json({ code: 1002, message: 'Invoice does not exist.' }, 404),
    ]);
    await books.invoices.get('1');
    expect(events()).toHaveLength(0);
    await books.invoices.get('9').catch(() => undefined);
    const [e] = events();
    expect(e).toMatchObject({
      level: 40,
      name: 'zoho-books-sdk',
      event: 'zoho.request.failed',
      category: 'http',
      method: 'GET',
      path: '/invoices/9',
      organizationId: '600000001',
      status: 404,
      code: 1002,
      zohoMessage: 'Invoice does not exist.',
      attempts: 1,
    });
    expect(typeof e!.time).toBe('number');
    expect(typeof e!.requestId).toBe('string');
  });

  it('logs server failures as errors and each retry as a warning', async () => {
    const { books, events } = setup([json({ code: 1000, message: 'Internal' }, 503), json({ code: 1000, message: 'Internal' }, 503), json({ code: 1000, message: 'Internal' }, 503)]);
    await books.invoices.get('1').catch(() => undefined);
    expect(events().map((e) => [e.level, e.event])).toEqual([
      [40, 'zoho.request.retry'],
      [40, 'zoho.request.retry'],
      [50, 'zoho.request.failed'],
    ]);
    expect(events()[0]).toMatchObject({ attempt: 1, status: 503 });
  });

  it('logs rate limits with their kind and the daily quota as an error', async () => {
    const { books, events } = setup([json({ code: 44, message: 'slow down' }, 429), json({ code: 45, message: 'daily limit' }, 429)]);
    await books.invoices.get('1').catch(() => undefined);
    expect(events().map((e) => [e.level, e.event, e.kind])).toEqual([
      [40, 'zoho.request.rate_limited', 'minute'],
      [50, 'zoho.request.rate_limited', 'daily'],
    ]);
  });

  it('writes a readable line in pretty format', async () => {
    const { books, lines } = setup([json({ code: 1002, message: 'Invoice does not exist.' }, 404)], { format: 'pretty' });
    await books.invoices.get('9').catch(() => undefined);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT\S+ WARN  zoho\.request\.failed Invoice does not exist\. .* status=404 code=1002/);
  });
});

describe('levels', () => {
  it('debug adds every completed request with its duration', async () => {
    const { books, events } = setup([json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } })], { level: 'debug' });
    await books.invoices.get('1');
    expect(events()[0]).toMatchObject({ level: 20, event: 'zoho.request.completed', status: 200, attempt: 1 });
    expect(typeof events()[0]!.durationMs).toBe('number');
  });

  it('per category levels override the base level', async () => {
    const m = mockFetch()
      .on('POST', '/oauth/v2/token', () => json({ access_token: 'tok', expires_in: 3600 }))
      .on('GET', /.*/, () => json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } }));
    const lines: string[] = [];
    const books = new ZohoBooks({
      clientId: 'c',
      clientSecret: 'super-secret',
      refreshToken: 'r',
      organizationId: '1',
      fetch: m.fetch,
      rateLimit: false,
      logging: { level: 'error', levels: { auth: 'info' }, destination: { write: (s: string) => lines.push(s) } },
    });
    await books.invoices.get('1');
    const events = lines.map((l) => JSON.parse(l));
    expect(events.map((e) => e.event)).toEqual(['zoho.token.refreshed']);
    expect(lines.join('')).not.toContain('super-secret');
  });

  it('logger false writes nothing and lazy fields are never built when disabled', async () => {
    const log = createSdkLogger(false);
    let built = false;
    log.error('http', 'x', 'y', () => {
      built = true;
      return {};
    });
    expect(built).toBe(false);
  });
});

describe('redaction', () => {
  it('never logs tokens or secrets and masks PII by default', () => {
    const out = redact({
      Authorization: 'Zoho-oauthtoken 1000.abc',
      refresh_token: 'r',
      client_secret: 's',
      nested: { gst_no: '27AAPFU0939F1ZV', email: 'ravi@example.com', to_mail_ids: ['a@b.in'] },
    });
    expect(out).toEqual({
      Authorization: '[REDACTED]',
      refresh_token: '[REDACTED]',
      client_secret: '[REDACTED]',
      nested: { gst_no: '27***ZV', email: 'ra***om', to_mail_ids: ['a@***in'] },
    });
  });

  it('keeps PII when turned off but still hides secrets, and hides extra keys', () => {
    expect(redact({ email: 'ravi@example.com', password: 'p', note: 'x' }, { pii: false, keys: ['note'] })).toEqual({
      email: 'ravi@example.com',
      password: '[REDACTED]',
      note: '[REDACTED]',
    });
  });

  it('masks query filters and error bodies when bodies are logged', async () => {
    const { books, lines, events } = setup(
      [json({ code: 3001, message: 'Duplicate', contact: { gst_no: '27AAPFU0939F1ZV' } }, 400)],
      { bodies: 'errors' },
    );
    await books.contacts.findByEmail('ravi@example.com').catch(() => undefined);
    const e = events()[0]!;
    expect((e.query as Record<string, unknown>).email).toBe('ra***om');
    expect(e.responseBody).toMatchObject({ contact: { gst_no: '27***ZV' } });
    expect(lines.join('')).not.toContain('ravi@example.com');
    expect(lines.join('')).not.toContain('SECRET_ACCESS');
  });

  it('logs request and response bodies only when bodies is all, cut to maxBodyLength', async () => {
    const { books, events } = setup([json({ code: 0, message: 'ok', invoice: { invoice_id: '1', notes: 'x'.repeat(500) } })], {
      level: 'debug',
      bodies: 'all',
      maxBodyLength: 50,
    });
    await books.invoices.get('1');
    expect(String(events()[0]!.responseBody)).toMatch(/…\(\d+ more\)$/);
  });
});

describe('bring your own logger', () => {
  it('detects Pino, passes fields first, and follows its level', async () => {
    const { pino, calls } = fakePino('info');
    const m = mockFetch()
      .on('POST', '/oauth/v2/token', () => json({ access_token: 'tok', expires_in: 3600 }))
      .on('GET', /.*/, () => json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } }));
    const books = new ZohoBooks({ clientId: 'c', clientSecret: 's', refreshToken: 'r', organizationId: '1', fetch: m.fetch, rateLimit: false, logger: pino as never });
    await books.invoices.get('1');
    expect(calls).toEqual([expect.objectContaining({ level: 'info', msg: 'Refreshed the Zoho access token', fields: expect.objectContaining({ event: 'zoho.token.refreshed' }) })]);
  });

  it('works with Winston style loggers that take the message first', async () => {
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const winston = {
      level: 'warn',
      debug: (msg: string, meta: Record<string, unknown>) => calls.push(['debug', msg, meta]),
      info: (msg: string, meta: Record<string, unknown>) => calls.push(['info', msg, meta]),
      warn: (msg: string, meta: Record<string, unknown>) => calls.push(['warn', msg, meta]),
      error: (msg: string, meta: Record<string, unknown>) => calls.push(['error', msg, meta]),
    };
    const m = mockFetch([json({ code: 1002, message: 'Invoice does not exist.' }, 404)]);
    const books = new ZohoBooks({ accessToken: 't', organizationId: '1', fetch: m.fetch, rateLimit: false, logger: winston });
    await books.invoices.get('9').catch(() => undefined);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('warn');
    expect(calls[0]![2]).toMatchObject({ event: 'zoho.request.failed', status: 404 });
  });

  it('a throwing logger never breaks a request', async () => {
    const boom = () => {
      throw new Error('logger down');
    };
    const m = mockFetch([json({ code: 1000, message: 'x' }, 503), json({ code: 0, message: 'ok', invoice: { invoice_id: '1' } })]);
    const books = new ZohoBooks({
      accessToken: 't',
      organizationId: '1',
      fetch: m.fetch,
      rateLimit: false,
      retry: { baseDelayMs: 1, maxDelayMs: 1 },
      logger: { debug: boom, info: boom, warn: boom, error: boom },
      logging: { level: 'trace' },
    });
    await expect(books.invoices.get('1')).resolves.toMatchObject({ invoice_id: '1' });
  });

  it('adds context fields such as a trace id to every event', async () => {
    const { books, events } = setup([json({ code: 1002, message: 'nope' }, 404)], { context: () => ({ traceId: 'abc123' }) });
    await books.invoices.get('9').catch(() => undefined);
    expect(events()[0]).toMatchObject({ traceId: 'abc123' });
  });
});

describe('domain events', () => {
  it('logs token refresh failures as errors', async () => {
    const lines: string[] = [];
    const m = mockFetch([json({ error: 'invalid_client' })]);
    const books = new ZohoBooks({ clientId: 'c', clientSecret: 's', refreshToken: 'r', organizationId: '1', fetch: m.fetch, rateLimit: false, logging: { destination: { write: (s: string) => lines.push(s) } } });
    await books.invoices.get('1').catch(() => undefined);
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 50, event: 'zoho.token.refresh_failed', oauthError: 'invalid_client' });
  });

  it('logs GST rejections before throwing', async () => {
    const { books, events } = setup([json({ code: 0, message: 'ok', taxes: [] })], {}, { gst: { homeState: 'MH' } });
    const contact = { contact_id: 'c', contact_name: 'x', gst_treatment: 'consumer', gst_no: '27AAPFU0939F1ZV' };
    await books.gst.prepareInvoice({ customer_id: 'c', line_items: [] }, { contact }).catch(() => undefined);
    expect(events()[0]).toMatchObject({ level: 40, event: 'zoho.gst.rejected', field: 'gst_no' });
  });

  it('logs workflow steps at info, holds as warnings and money mismatches as errors', async () => {
    const m = mockFetch()
      .on('GET', /\/contacts$/, () => json({ code: 0, message: 'ok', contacts: [] }))
      .on('POST', /\/contacts$/, () => json({ code: 0, message: 'ok', contact: { contact_id: 'c1' } }))
      .on('GET', /\/invoices$/, () => json({ code: 0, message: 'ok', invoices: [{ invoice_id: 'i1', reference_number: 'ORD-1', total: 1500 }] }));
    const lines: string[] = [];
    const books = new ZohoBooks({ accessToken: 't', organizationId: '1', fetch: m.fetch, rateLimit: false, logging: { level: 'info', destination: { write: (s: string) => lines.push(s) } } });
    const wf = new InvoiceWorkflow(books, { save: () => {} });
    const order = {
      reference: 'ORD-1',
      paidAt: new Date(),
      currency: 'INR',
      profile: { kind: 'consumer' as const, legalName: 'Ravi', email: 'ravi@example.com' },
      lines: [{ name: 'Credits', quantity: 1, unitAmountMinor: 100000, gstRate: 18 }],
      capturedMinor: 118000,
      payment: { reference: 'pay_1', mode: 'creditcard', depositAccountId: 'acc' },
    };
    await wf.run({ ...order, currency: 'USD' });
    await wf.run(order);
    const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events.map((e) => [e.level, e.event, e.step ?? ''])).toEqual([
      [40, 'zoho.workflow.held', ''],
      [30, 'zoho.workflow.step', 'contact'],
      [30, 'zoho.workflow.step', 'invoice'],
      [50, 'zoho.workflow.review', ''],
    ]);
    expect(events[2]).toMatchObject({ action: 'adopted', invoiceId: 'i1', reference: 'ORD-1' });
    expect(lines.join('')).not.toContain('ravi@example.com');
  });
});

describe('request ids', () => {
  it('stay the same across retries of one call', async () => {
    const { books, events } = setup([json({ code: 1000, message: 'x' }, 503), json({ code: 1000, message: 'x' }, 503), json({ code: 1000, message: 'x' }, 503)]);
    await books.invoices.get('1').catch(() => undefined);
    expect(new Set(events().map((e) => e.requestId)).size).toBe(1);
  });
});

