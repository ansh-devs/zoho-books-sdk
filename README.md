# @ansh-devs/zoho-books-sdk

Type-safe, zero-dependency **Node.js SDK for the Zoho Books API v3**, with first-class **India GST** and **e-invoicing (IRN)** support.

```bash
npm install @ansh-devs/zoho-books-sdk
```

> Unofficial. Not affiliated with or endorsed by Zoho Corporation. "Zoho" and "Zoho Books" are trademarks of their respective owner.

- **Seamless API:** `books.invoices.create()`, `books.invoices.einvoice.push()`, `for await (const inv of books.invoices.iterate())`
- **OAuth done right:** automatic refresh that never sends duplicate refresh requests, a pluggable token store (Redis, a database) and all 10 Zoho data centers
- **Safe retries:** jittered backoff, 401 refresh-and-replay, and per-org rate and concurrency limiting. POSTs are never retried after a 5xx, so you don't get duplicate invoices.
- **Typed errors:** `ZohoRateLimitError` (`kind: 'minute' | 'daily' | 'concurrency'`), `ZohoValidationError`, `ZohoNotFoundError`, and more. A non-zero Zoho `code` is always thrown, even when the HTTP status is 200.
- **GST toolkit:** GSTIN checksum validation, HSN/SAC checks, Zoho's state codes, intra- vs inter-state detection, CGST/SGST/IGST math in whole paise, and automatic tax selection
- **Paid-order workflow:** contact, invoice, payment, IRP push and email in one resumable call, with holds for anything that shouldn't be invoiced automatically
- **Files:** PDF download (single and bulk), attachments, receipts
- **Webhooks:** `verifyWebhookSignature()` for `X-Zoho-Webhook-Signature`
- **Logging:** structured JSON out of the box, with redaction, levels per area and stable event names. Bring Pino, Winston or any logger
- **Packaging:** dual ESM/CJS with full `.d.ts`; Node ≥ 18.17; no runtime dependencies

---

## Quick start

```ts
import { ZohoBooks } from '@ansh-devs/zoho-books-sdk';

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
import { ZohoOAuth, Scopes } from '@ansh-devs/zoho-books-sdk';

const oauth = new ZohoOAuth({ clientId, clientSecret, dataCenter: 'in' });

const url = oauth.authorizationUrl({
  scopes: Scopes.invoicing(),        // or Scopes.all(), or scope('invoices', 'READ')
  redirectUri: 'https://your.app/zoho/callback',
  prompt: 'consent',                 // ensures a refresh token is issued
});

// in your callback handler:
const callback = ZohoOAuth.parseCallback(req.url);
const { refresh_token, dataCenter } = await oauth.exchangeCode(callback.code!, 'https://your.app/zoho/callback', callback);
```

Store `dataCenter` next to the refresh token; later refreshes must go to that data center.

**Users in other data centers.** Always start the consent redirect at your client's home data center. Zoho sends the user's real data center back on the callback (`location` and `accounts-server`), and `exchangeCode` uses it when you pass the parsed callback. Each extra data center needs Multi DC enabled for your client in the Zoho API console. Pass `allowedDataCenters: ['in', 'eu']` to `ZohoOAuth` to get a clear error, instead of Zoho's "Invalid client", when someone signs in from a data center you haven't enabled.

Grant codes expire within minutes and work only once. Zoho keeps at most 20 refresh tokens per user and silently deletes the oldest, so store each refresh token and reuse it.

3. Find your organization id:

```ts
const orgs = await new ZohoBooks({ clientId, clientSecret, refreshToken, dataCenter: 'in' }).organizations.list();
```

## India GST invoicing

Give the helper a customer and line items with a `gstRate`. It then:

- works out `place_of_supply` from the request, the contact's `place_of_contact` or the GSTIN state code. A consumer with no address is placed in your own state (IGST Act s.12(2)(b))
- validates the GSTIN, requires one for B2B, and refuses one on consumer, unregistered or overseas invoices
- checks that the place of supply matches the GSTIN's state (set `strictPlaceOfSupply: false` for goods shipped to another state)
- decides intra-state (CGST+SGST) or inter-state (IGST), treating SEZ and overseas as inter-state
- fills in each line's tax: a CGST+SGST group goes in `tax_group_id`, IGST goes in `tax_id`
- refuses to silently charge IGST on exports: overseas customers need `exportMode: 'lut'` (zero rated) or `exportMode: 'igst'`

All validation runs before anything is written to Zoho.

**Collect the GSTIN before invoicing.** An invoice raised as B2C and later changed to B2B needs a GSTR-1 amendment (Table 9A), and the buyer's input tax credit arrives late.

**State codes.** Zoho uses its own two-letter codes, which differ from the common ones for Andhra Pradesh (`AD`, not `AP`) and Uttarakhand (`UK`, not `UT`). The SDK accepts either form, or the GST prefix (`"23"` and `"MP"` are both Madhya Pradesh), and sends Zoho's code. Retired prefixes 25 and 28 are refused for new data but accepted on old GSTINs.

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

These also work in the browser through the `@ansh-devs/zoho-books-sdk/gst` sub-path:

```ts
import { parseGstin, validateHsnOrSac, computeGst, determineSupplyType, toPlaceOfSupply, validateBillingProfile, toZohoDate } from '@ansh-devs/zoho-books-sdk/gst';

parseGstin('27AAPFU0939F1ZV');
// { valid: true, state: { code: 'MH', name: 'Maharashtra', ... }, pan: 'AAPFU0939F', kind: 'regular' }

determineSupplyType({ homeState: 'KA', placeOfSupply: 'MH' }); // 'inter'

computeGst([{ quantity: 2, rate: 499.5, gstRate: 18 }], { supplyType: 'intra', roundToRupee: true });
// { taxableValue: 999, cgst: 89.91, sgst: 89.91, igst: 0, total: 1178.82, roundOff: 0.18, grandTotal: 1179, lines: [...] }

validateBillingProfile({ kind: 'business', legalName: 'Acme', gstin: '27AAPFU0939F1ZV', state: 'KA' });
// ['address is required', ..., 'gstin belongs to Maharashtra, but state is Karnataka']

toZohoDate(new Date('2026-10-31T19:00:00Z')); // '2026-11-01', the India date, not the UTC one
```

Always date invoices and payments with `toZohoDate`. A UTC date puts payments made between midnight and 05:30 IST on the previous day, and at a month end in the previous GST return period.

### E-invoicing (IRN)

```ts
await books.invoices.einvoice.push(invoiceId);          // generate the IRN on the IRP
const e = await books.invoices.einvoice.get(invoiceId); // IRN, ack no/date, signed QR

import { canCancelIrn } from '@ansh-devs/zoho-books-sdk/gst';
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

On an e-invoicing org, Zoho refuses to email a B2B invoice until it has been pushed to the IRP ("has not been e-Invoiced. Push it to the IRP to proceed"). Push only after the payment is recorded and the totals are verified, so a wrong invoice is never registered. Consumer invoices are not e-invoiced.

## Invoicing a paid order end to end

`InvoiceWorkflow` runs the whole flow for one paid order: contact, invoice, payment, IRP push and email. It saves Zoho's ids after every step, so a crash resumes instead of creating duplicates.

```ts
import { InvoiceWorkflow, nextRetryAt } from '@ansh-devs/zoho-books-sdk';

const workflow = new InvoiceWorkflow(books, {
  einvoicing: true,                         // push B2B invoices to the IRP before emailing
  save: (state) => db.orders.update(orderId, { zoho: state }),
  holdRules: [(order) => (knownSku(order) ? undefined : 'unknown product')],
});

const outcome = await workflow.run(
  {
    reference: 'ORD-1042',                  // sent as reference_number
    paidAt: payment.createdAt,
    currency: payment.currency,
    profile: { kind: 'business', legalName: 'Acme Pvt Ltd', email: 'ap@acme.in', gstin: '27AAPFU0939F1ZV', address: '1 Road', city: 'Pune', state: 'MH', pin: '411001' },
    lines: [{ name: 'Credits', quantity: 1, unitAmountMinor: 100000, gstRate: 18, hsnOrSac: '998314' }],
    capturedMinor: 118000,                  // what the gateway took, in paise
    payment: { reference: payment.id, mode: 'creditcard', depositAccountId: '460000000000123' },
  },
  savedState,                               // ids from an earlier attempt, if any
);
```

What it does for you:
- **Holds** orders that shouldn't be invoiced automatically: non-INR currency, overseas customers without `exportMode`, billing profiles that fail GST Rule 46, and your own `holdRules`.
- **Finds an earlier attempt** by your order reference. Zoho's filter isn't exact, so only an exact `reference_number` match is adopted.
- **Reuses a contact found by email**, and always updates it with the profile's current GST details. A profile with `systemGenerated: true` never adopts a contact by email, so it can't overwrite one your accountant set up with a GSTIN.
- **Checks the total** before recording money. Zoho recomputes tax per line, so a gap of up to ₹0.05 is settled at Zoho's figure. A bigger gap records nothing and returns `review`.
- **Skips the payment** if the invoice is already paid.
- **Handles a refused second IRP push** (for example after a crash between push and email): if the email then goes through, the invoice was already registered.

`outcome.status` is one of:

| Status | Meaning |
|---|---|
| `done` | Finished. |
| `held` | Needs a person. `reason` says why. |
| `review` | Zoho's total differs from the captured amount. Nothing was recorded; alert someone. |
| `retry` | Failed. Count an attempt and schedule `nextRetryAt(attempts)`: 2, 10, 60, 360, then 1440 minutes, then stop and alert. An admin retry resets the count. |
| `rate_limited` | Zoho's limit. Don't count an attempt, and stop the batch. |

For legacy orders that only have a gross total, set `inclusiveOfTax: true` and use the total as the line amount; Zoho derives the tax.

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
import { ZohoRateLimitError, ZohoValidationError, ZohoNotFoundError, ZohoGstError } from '@ansh-devs/zoho-books-sdk';

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
| `ZohoNoRecordError` | Zoho reported success but returned no record or id |
| `ZohoConfigError` | Invalid usage caught before any request, such as an empty id or an endpoint the module lacks |

All of them extend `ZohoBooksError` and carry `status`, `code`, `method`, `path`, `body` and `headers`.

Prefer results to exceptions in a job runner? Wrap any call in `settle`:

```ts
import { settle } from '@ansh-devs/zoho-books-sdk';

const res = await settle(books.invoices.get(id));
if (!res.success) console.log(res.code); // NETWORK, RATE_LIMITED, UNAUTHORIZED, INVALID_CREDENTIALS, ZOHO_1002, ZOHO_NO_ID, ...
```

## Retries, rate limits and idempotency

- Every request has a 20 s timeout by default (`timeoutMs` changes it).
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

Zoho allows only **10 access tokens per 10 minutes, and 15 active, per refresh token**, so several processes starting together can lock you out. Within a single process the SDK never refreshes twice at once. Across replicas, share the token through a cache with `cacheTokenStore`. One process takes a lock (SET NX EX, 30 s) and refreshes. The others wait, then reuse its token, and refresh themselves if the holder failed. If the cache is down, the SDK refreshes anyway rather than stopping.

```ts
import { cacheTokenStore } from '@ansh-devs/zoho-books-sdk';

const tokenStore = cacheTokenStore({
  get: (k) => redis.get(k),
  set: (k, v, ttl) => redis.set(k, v, 'EX', ttl),
  setIfAbsent: async (k, v, ttl) => (await redis.set(k, v, 'EX', ttl, 'NX')) === 'OK',
  delete: (k) => redis.del(k),
});

new ZohoBooks({ ..., tokenStore });
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
import { verifyWebhookSignature } from '@ansh-devs/zoho-books-sdk';

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

## Logging

The SDK logs structured events out of the box, with no dependency. Plug in your own logger and its events flow there instead.

```ts
new ZohoBooks({ ... });                                    // built-in JSON logger on stderr, warn and above
new ZohoBooks({ ..., logger: pino() });                    // your Pino, detected automatically, follows its level
new ZohoBooks({ ..., logger: winston.createLogger(...) }); // Winston, console, or anything with debug/info/warn/error
new ZohoBooks({ ..., logger: false });                     // silent
```

The built-in logger writes one JSON object per line in Pino's format (`level` 10 to 50, `time`, `pid`, `hostname`, `name`, `msg`, then the event's fields), so moving to real Pino later changes nothing downstream. Set `format: 'pretty'`, or `ZOHO_BOOKS_LOG_FORMAT=pretty`, for readable lines while developing.

**Recommended pairing for production: Pino.** It is several times faster than Winston and writes JSON natively.

### Options

```ts
new ZohoBooks({
  ...,
  logging: {
    level: 'info',                          // default: ZOHO_BOOKS_LOG_LEVEL, else your logger's level, else 'warn'
    levels: { http: 'debug', auth: 'info' },// per category: http, auth, gst, workflow
    redact: { pii: true, keys: ['notes'] }, // pii masks GSTIN, PAN, email, phone (default on); keys hides extra fields
    bodies: 'errors',                       // 'none' (default), 'errors' or 'all'; always redacted
    maxBodyLength: 2000,
    context: () => ({ traceId: trace.getActiveSpan()?.spanContext().traceId }),
    format: 'json',                         // built-in logger only: 'json' or 'pretty'
    destination: process.stdout,            // built-in logger only, default process.stderr
  },
});
```

- **Secrets are always hidden** and this can't be turned off: access and refresh tokens, `Authorization` headers and client secrets.
- **PII is masked by default** (`27***ZV`, `ra***om`): GSTIN, PAN, email, phone and email recipient lists, including inside query filters and bodies.
- **Bodies are off by default**, because they contain customer data.
- **A logger that throws never breaks an API call**, and fields for disabled levels are never built.
- **Every API call has a `requestId`**, kept across its retries, so one call's lines group together.

### What you'll see by default (warn and above)

Successful calls are silent. These are real lines from the built-in logger; `time`, `pid` and `hostname` are left out for brevity.

`books.invoices.get('460000000099999')`, which returns 404 with Zoho code 1002:
```json
{"level":40,"name":"zoho-books-sdk","msg":"Invoice does not exist. [code 1002] (GET /invoices/460000000099999)","event":"zoho.request.failed","category":"http","requestId":"509656d2","method":"GET","path":"/invoices/460000000099999","organizationId":"600000001","status":404,"code":1002,"error":"ZohoNotFoundError","zohoMessage":"Invoice does not exist.","attempts":1,"durationMs":0}
```

`books.contacts.list()`, which gets a 503 and then succeeds on retry:
```json
{"level":40,"name":"zoho-books-sdk","msg":"HTTP 503; retrying in 1 ms (attempt 1)","event":"zoho.request.retry","category":"http","requestId":"ca25d103","method":"GET","path":"/contacts","organizationId":"600000001","attempt":1,"delayMs":1,"status":503,"code":1000,"error":"ZohoServerError"}
```

`books.invoices.list()` hitting the per-minute limit:
```json
{"level":40,"name":"zoho-books-sdk","msg":"Zoho minute rate limit hit; retrying in 60000 ms","event":"zoho.request.rate_limited","category":"http","requestId":"6c5fccab","method":"GET","path":"/invoices","organizationId":"600000001","attempt":1,"delayMs":60000,"status":429,"code":44,"error":"ZohoRateLimitError","kind":"minute"}
```

`books.invoices.create(...)` getting a 500, which is an error and is not retried, so no duplicate invoice:
```json
{"level":50,"name":"zoho-books-sdk","msg":"Internal Server Error [code 1000] (POST /invoices)","event":"zoho.request.failed","category":"http","requestId":"8e5116ea","method":"POST","path":"/invoices","organizationId":"600000001","status":500,"code":1000,"error":"ZohoServerError","zohoMessage":"Internal Server Error","attempts":1,"durationMs":0}
```

The first call with a wrong client secret:
```json
{"level":50,"name":"zoho-books-sdk","msg":"Zoho OAuth token request failed: invalid_client (wrong client id or secret, or Multi DC is not enabled for this data center in the Zoho API console)","event":"zoho.token.refresh_failed","category":"auth","oauthError":"invalid_client","status":200,"durationMs":2}
```

`InvoiceWorkflow.run()` for a USD order:
```json
{"level":40,"name":"zoho-books-sdk","msg":"Currency USD is not INR","event":"zoho.workflow.held","category":"workflow","organizationId":"600000001","reference":"ORD-1042"}
```

At `info`, token refreshes and each workflow step appear too:
```json
{"level":30,"name":"zoho-books-sdk","msg":"payment recorded","event":"zoho.workflow.step","category":"workflow","organizationId":"600000001","reference":"ORD-1042","step":"payment","action":"recorded","paymentId":"460000000054321","amount":1180}
```

At `debug`, every completed request appears with its duration. In `pretty` format:
```
2026-11-06T15:38:12.579Z DEBUG zoho.request.completed GET /contacts 200 requestId=4c8b10f6 method=GET path=/contacts organizationId=600000001 status=200 attempt=2 durationMs=0
```

### Events

| Event | Level | When |
|---|---|---|
| `zoho.request.started` | trace | Each attempt starts (with the request body when `bodies` is `all`) |
| `zoho.request.completed` | debug | A call succeeded, with status and duration |
| `zoho.request.throttled` | debug | A call waited 1 s or more for the rate limiter |
| `zoho.request.retry` | warn | A 5xx, network error or timeout will be retried |
| `zoho.request.rate_limited` | warn, error for the daily quota | Zoho returned 429, with `kind`: minute, daily or concurrency |
| `zoho.request.failed` | warn for 4xx, error for 5xx, network, 401 and 403 | A call failed and will not be retried |
| `zoho.request.aborted` | debug | Your `AbortSignal` cancelled a call |
| `zoho.token.refreshed` | info | A new access token was minted |
| `zoho.token.refresh_failed` | error | The token endpoint refused, with `oauthError` |
| `zoho.token.rejected` | warn | Zoho returned 401; the SDK refreshes and retries once |
| `zoho.token.cache_unavailable` | warn | The token cache failed; the SDK continues without it |
| `zoho.api_domain.switched` | info | The SDK moved to the API host Zoho reported with the token |
| `zoho.gst.prepared` | debug | A GST invoice payload was built, with supply type and place of supply |
| `zoho.gst.rejected` | warn | GST validation refused a document before any request |
| `zoho.gst.taxes_reloaded` | info | A rate was missing from the cached taxes |
| `zoho.workflow.step` | info | contact, invoice, payment, einvoice or email: created, adopted, resumed, recorded, skipped, pushed or sent |
| `zoho.workflow.done` | info | An order is fully invoiced |
| `zoho.workflow.held` | warn | An order needs a person |
| `zoho.workflow.review` | error | Zoho's total differs from the captured amount; nothing was recorded |
| `zoho.workflow.retry` / `rate_limited` | warn | A step failed or hit Zoho's limit |
| `zoho.einvoice.push_failed` | warn | The IRP push was refused |
| `zoho.einvoice.already_registered` | info | The push was refused but the email went through |

You can log your own events in the same format with `books.log`, for example `books.log.info('workflow', 'app.order.synced', 'Synced', { orderId })`.

### Metrics hooks

For metrics rather than logs, use `hooks`:

```ts
new ZohoBooks({
  ...,
  hooks: {
    onResponse: ({ status, durationMs }) => metrics.histogram('zoho.latency', durationMs, { status }),
    onRetry: ({ attempt }) => metrics.increment('zoho.retries', { attempt }),
  },
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
```

### Releases

Merging into `master` releases automatically. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) and decide the version: `fix:` is a patch, `feat:` a minor, and `feat!:` or a `BREAKING CHANGE:` footer a major. Release notes are on [GitHub Releases](https://github.com/ansh-devs/zoho-books-sdk/releases).

See [PLAN.md](./PLAN.md) for the research, design decisions and roadmap.

## License

MIT
