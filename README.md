# zoho-books-sdk

Type-safe, zero-dependency **Node.js SDK for the Zoho Books API v3**, with first-class **India GST** and **e-invoicing (IRN)** support.

```bash
npm install zoho-books-sdk
```

> Unofficial. Not affiliated with or endorsed by Zoho Corporation. "Zoho" and "Zoho Books" are trademarks of their respective owner.

- **Seamless API:** `books.invoices.create()`, `books.invoices.einvoice.push()`, `for await (const inv of books.invoices.iterate())`
- **OAuth done right:** automatic refresh that never sends duplicate refresh requests, a pluggable token store (Redis, a database) and all 10 Zoho data centers
- **Safe retries:** jittered backoff, 401 refresh-and-replay, and per-org rate and concurrency limiting. POSTs are never retried after a 5xx, so you don't get duplicate invoices.
- **Typed errors:** `ZohoRateLimitError` (`kind: 'minute' | 'daily' | 'concurrency'`), `ZohoValidationError`, `ZohoNotFoundError`, and more. A non-zero Zoho `code` is always thrown, even when the HTTP status is 200.
- **GST toolkit:** GSTIN checksum validation, HSN/SAC checks, state codes, intra- vs inter-state detection, CGST/SGST/IGST math, and automatic `tax_id` selection
- **Files:** PDF download (single and bulk), attachments, receipts
- **Webhooks:** `verifyWebhookSignature()` for `X-Zoho-Webhook-Signature`
- **Packaging:** dual ESM/CJS with full `.d.ts`; Node ≥ 18.17; no runtime dependencies

---

## Quick start

```ts
import { ZohoBooks } from 'zoho-books-sdk';

const books = new ZohoBooks({
  dataCenter: 'in',                         // us | eu | in | au | jp | ca | cn | sa | ae | uk
  organizationId: process.env.ZOHO_ORG_ID,
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
});

const invoice = await books.invoices.create(
  {
    customer_id: '460000000026049',
    line_items: [{ item_id: '460000000027009', quantity: 2, rate: 1500 }],
  },
  { send: true },
);

await books.invoices.markSent(invoice.invoice_id);
const pdf = await books.invoices.pdf(invoice.invoice_id); // { data: Uint8Array, filename, contentType }
```

Or configure from environment variables (`ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID`, `ZOHO_DATA_CENTER`):

```ts
const books = ZohoBooks.fromEnv();
```

## Getting a refresh token

1. Create a **Server-based Application** (or a **Self Client**) at the Zoho API console for your data center, e.g. <https://api-console.zoho.in>.
2. Send the user to the consent URL, then exchange the code:

```ts
import { ZohoOAuth, Scopes } from 'zoho-books-sdk';

const oauth = new ZohoOAuth({ clientId, clientSecret, dataCenter: 'in' });

const url = oauth.authorizationUrl({
  scopes: Scopes.invoicing(),        // or Scopes.all(), or scope('invoices', 'READ')
  redirectUri: 'https://your.app/zoho/callback',
  prompt: 'consent',                 // ensures a refresh token is issued
});

// in your callback handler:
const { refresh_token, api_domain } = await oauth.exchangeCode(code, 'https://your.app/zoho/callback');
```

Grant codes expire within minutes and work only once. Zoho keeps at most 20 refresh tokens per user and silently deletes the oldest, so store each refresh token and reuse it.

3. Find your organization id:

```ts
const orgs = await new ZohoBooks({ clientId, clientSecret, refreshToken, dataCenter: 'in' }).organizations.list();
```

## India GST invoicing

Give the helper a customer and line items with a `gstRate`. It then:

- works out `place_of_supply` from the request, the contact's `place_of_contact` or the GSTIN state code
- validates the GSTIN and checks that B2B treatments have one
- decides intra-state (CGST+SGST) or inter-state (IGST), treating SEZ and overseas as inter-state
- fills in the right Zoho `tax_id` on every line from your org's configured taxes

All validation runs before anything is written to Zoho.

```ts
const invoice = await books.gst.createInvoice(
  {
    customer_id: '460000000026049',
    line_items: [
      { item_id: '460000000027009', quantity: 1, rate: 25000, gstRate: 18, hsn_or_sac: '998314' },
      { name: 'Shipping', quantity: 1, rate: 500, gstRate: 18, hsn_or_sac: '996812' },
    ],
  },
  { send: false },
);
```

Configure it once on the client:

```ts
new ZohoBooks({
  // ...
  gst: {
    homeState: 'KA',                         // optional, read from the organization
    validateHsn: { minDigits: 6 },           // enforce HSN/SAC length (AATO > ₹5 Cr)
    requireHsn: true,                        // required for e invoicing
    taxMap: { 18: { intra: '4600000001', inter: '4600000002' } }, // optional explicit mapping
  },
});
```

Prefer to see the payload before sending? Use `books.gst.prepareInvoice(...)`. It returns `{ payload, supplyType, placeOfSupply, gstTreatment }`. Credit notes work the same way through `books.gst.createCreditNote(...)`.

### Pure GST utilities (no network)

These also work in the browser through the `zoho-books-sdk/gst` sub-path:

```ts
import { parseGstin, validateHsnOrSac, computeGst, determineSupplyType, toPlaceOfSupply } from 'zoho-books-sdk/gst';

parseGstin('27AAPFU0939F1ZV');
// { valid: true, state: { code: 'MH', name: 'Maharashtra', ... }, pan: 'AAPFU0939F', kind: 'regular' }

determineSupplyType({ homeState: 'KA', placeOfSupply: 'MH' }); // 'inter'

computeGst([{ quantity: 2, rate: 499.5, gstRate: 18 }], { supplyType: 'intra', roundToRupee: true });
// { taxableValue: 999, cgst: 89.91, sgst: 89.91, igst: 0, total: 1178.82, roundOff: 0.18, grandTotal: 1179, lines: [...] }
```

### E-invoicing (IRN)

```ts
await books.invoices.einvoice.push(invoiceId);          // generate the IRN on the IRP
const e = await books.invoices.einvoice.get(invoiceId); // IRN, ack no/date, signed QR

import { canCancelIrn } from 'zoho-books-sdk/gst';
if (canCancelIrn(e.ack_date)) {
  await books.invoices.einvoice.cancel(invoiceId, { reason: '2', remarks: 'Data entry mistake' });
} else {
  // After 24 h: cancel on the GST portal, then record it in Zoho
  await books.invoices.einvoice.markCancelled(invoiceId);
}

await books.invoices.einvoice.pushMany(['1', '2', '3']);   // bulk; check `errors` in the result
await books.creditNotes.einvoice.push(creditNoteId);
```

E-way bills and GST return filing are UI-only in Zoho Books. The API doesn't expose them.

## Pagination

```ts
// One page
const { items, pageContext, hasMore } = await books.invoices.list({ status: 'overdue', per_page: 50 });

// Every record, fetched lazily page by page (200 per page)
for await (const inv of books.invoices.iterate({ status: 'unpaid' })) {
  console.log(inv.invoice_number, inv.balance);
}

// Collect with a cap
const recent = await books.contacts.listAll({ sort_column: 'created_time', sort_order: 'D' }, { limit: 500 });
```

## Errors

```ts
import { ZohoRateLimitError, ZohoValidationError, ZohoNotFoundError, ZohoGstError } from 'zoho-books-sdk';

try {
  await books.invoices.create(data);
} catch (err) {
  if (err instanceof ZohoGstError) console.error('Fix before sending:', err.field, err.message);
  else if (err instanceof ZohoRateLimitError && err.kind === 'daily') scheduleForTomorrow();
  else if (err instanceof ZohoValidationError) console.error(err.code, err.message, err.body);
  else if (err instanceof ZohoNotFoundError) /* ... */;
  else throw err;
}
```

| Class | When |
|---|---|
| `ZohoValidationError` | HTTP 400, or a non-zero `code` (even with HTTP 200) |
| `ZohoAuthenticationError` | 401 that persists after one token refresh |
| `ZohoPermissionError` | 403, for example a missing scope |
| `ZohoNotFoundError` | 404, or code 1002 |
| `ZohoRateLimitError` | 429 (`kind`: `minute` = code 44, `daily` = code 45, `concurrency` = code 1070) |
| `ZohoServerError` | 5xx |
| `ZohoNetworkError` / `ZohoTimeoutError` | No response received |
| `ZohoOAuthError` | Token endpoint failure (`oauthError: 'invalid_code'`, ...) |
| `ZohoGstError` | Local GST validation failed; no request was sent |
| `ZohoConfigError` | Invalid usage caught before any request, such as an empty id or an endpoint the module lacks |

All of them extend `ZohoBooksError` and carry `status`, `code`, `method`, `path`, `body` and `headers`.

## Retries, rate limits and idempotency

- GET, PUT and DELETE are retried on 5xx, network errors and timeouts, using exponential backoff with full jitter (default 3 retries).
- **POST is not retried after a 5xx or timeout.** Zoho has no idempotency keys, so a retry could create a duplicate invoice. Pass `idempotent: true` to `books.request()` for POSTs you know are safe.
- 429s are always retried, because Zoho rejects them before processing. The exception is the **daily quota** (code 45), which fails fast.
- A client-side limiter keeps you under Zoho's limits: 100 requests per minute and 10 in flight, per organization. Tune or disable it:

```ts
new ZohoBooks({ ..., rateLimit: { requestsPerMinute: 90, maxConcurrent: 5 }, retry: { maxRetries: 5 }, timeoutMs: 60_000 });
```

- Pass an `AbortSignal` to cancel. It also cuts short a wait in back off or in the limiter queue:

```ts
await books.invoices.get(id, { signal: AbortSignal.timeout(5_000) });
```

- For safe sync from an external system, use **upsert by unique custom field**:

```ts
await books.invoices.upsertByCustomField('cf_order_id', 'ORD-1042', invoiceData, { upsert: true });
```

## Multi-instance deployments (k8s, serverless)

Zoho allows only **10 access tokens per 10 minutes, and 15 active, per refresh token**. Within a single process the SDK never refreshes twice at once. Across replicas, share one token store, ideally with a lock:

```ts
import type { TokenStore } from 'zoho-books-sdk';

const redisStore: TokenStore = {
  get: async (k) => JSON.parse((await redis.get(k)) ?? 'null') ?? undefined,
  set: async (k, t) => void (await redis.set(k, JSON.stringify(t), 'PXAT', t.expiresAt)),
  delete: async (k) => void (await redis.del(k)),
  withLock: async (k, fn) => withRedisLock(`${k}:lock`, 10_000, fn), // e.g. SET NX PX
};

new ZohoBooks({ ..., tokenStore: redisStore });
```

## Multiple organizations

Zoho's rate limits apply per organization, so use one client per org. `withOrganization` creates it once and returns the same client afterwards. It shares auth and the token cache, and has its own rate limiter.

```ts
const acme = books.withOrganization('600000001');
await acme.invoices.list();
```

A one off call can also pass `{ organizationId }` in its options. That call uses the parent client's rate limiter.

## Webhooks

```ts
import express from 'express';
import { verifyWebhookSignature } from 'zoho-books-sdk';

app.post('/zoho/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const ok = verifyWebhookSignature({
    secret: process.env.ZOHO_WEBHOOK_SECRET!,
    signature: req.header('x-zoho-webhook-signature'),
    query: req.query as Record<string, string>,
    rawBody: req.body,             // Buffer
  });
  if (!ok) return res.sendStatus(401);
  res.sendStatus(200);             // acknowledge quickly (Zoho times out at 10 s and retries)
  queue.push(JSON.parse(req.body.toString()));
});
```

## Resources

| Area | Client property |
|---|---|
| Sales | `contacts` (+ `.persons`), `items`, `estimates`, `salesOrders`, `invoices` (+ `.einvoice`), `recurringInvoices`, `retainerInvoices`, `creditNotes` (+ `.einvoice`), `debitNotes`, `salesReceipts`, `deliveryChallans`, `customerPayments` |
| Purchases | `bills`, `recurringBills`, `purchaseOrders`, `vendorCredits`, `vendorPayments`, `expenses`, `recurringExpenses` |
| Accounting | `chartOfAccounts`, `journals`, `bankAccounts`, `bankTransactions` |
| Settings | `organizations`, `taxes` (+ `.groups`), `currencies`, `users`, `locations`, `projects`, `timeEntries` |
| India | `gst` |

Each resource has `list`, `iterate`, `listAll`, `get`, `create`, `update` and `delete`. Documents also have `pdf`, plus whichever of these Zoho provides for that module: `bulkPdf`, `email`, `getEmailContent`, `submit`, `approve`, comments, attachments, billing and shipping address updates, `upsertByCustomField` and `deleteMany`. Each module's type only shows the methods Zoho really has (checked against Zoho's OpenAPI spec), so autocomplete never offers a call that would 404. Modules also have their own status actions such as `markSent`, `markVoid`, `writeOff`, `refund` and `applyCredits`.

Every method takes `CallOptions` as its last argument: `{ organizationId, signal, timeoutMs, headers, query }`. Create calls on invoices, estimates, sales orders and credit notes also accept `send` and `ignoreAutoNumberGeneration` there.

```ts
await books.invoices.get(id, { organizationId: '600000002' });
await books.invoices.create(data, { send: true, timeoutMs: 60_000 });
```

### Strict input types

Input and filter types are strict, so a typo such as `{ stauts: 'paid' }` fails to compile instead of silently returning every record. Filters on custom fields use the `cf_` prefix and are always allowed:

```ts
await books.invoices.list({ status: 'unpaid', cf_order_id: 'ORD-1042' });
```

For a query parameter the SDK does not type yet, pass it in `opts.query`. For a body field it does not type yet, build the object in a variable first, or use `books.request()`.

### Anything else: the escape hatch

The Books API has about 900 operations. For anything without a typed wrapper:

```ts
const dashboard = await books.request({ method: 'GET', path: '/invoices/dashboard' });
const file = await books.request({ method: 'GET', path: '/invoices/print', query: { invoice_ids: '1,2' }, responseType: 'binary' });
```

## Observability

```ts
new ZohoBooks({
  ...,
  hooks: {
    onRequest: ({ method, url, attempt }) => {},
    onResponse: ({ status, durationMs }) => metrics.histogram('zoho.latency', durationMs, { status }),
    onRetry: ({ attempt, delayMs, error }) => log.warn('zoho retry', { attempt, delayMs, error }),
  },
  logger: console,                       // any { debug, warn }
  onTokenRefreshed: (t) => log.info('zoho token refreshed', { expiresAt: t.expiresAt }),
});
```

## Testing your code

Inject `fetch` to stub Zoho, or point `baseUrl` at a mock server:

```ts
const books = new ZohoBooks({ accessToken: 'test', organizationId: '1', fetch: myMockFetch, rateLimit: false });
```

## Development

```bash
npm install
npm run check      # typecheck, tests, build, publint and attw
npm publish        # runs check first through prepublishOnly
```

Publishing from your machine works as is. The GitHub release workflow adds npm provenance, which npm only supports in CI.

See [PLAN.md](./PLAN.md) for the research, design decisions and roadmap.

## License

MIT
