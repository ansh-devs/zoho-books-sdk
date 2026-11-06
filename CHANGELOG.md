# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-05

### Added
- `ZohoBooks` client with 31 resources covering sales, purchases, accounting, banking and settings.
- OAuth: refresh-token, client-credentials (experimental), static token and custom providers; `ZohoOAuth` for consent URLs, code exchange, refresh and revoke; pluggable `TokenStore` with optional distributed lock; single-flight refresh.
- All Zoho data centers (`us`, `eu`, `in`, `au`, `jp`, `ca`, `cn`, `sa`, `ae`, `uk`) and `api_domain` following restricted to Zoho hosts.
- Transport: typed error hierarchy, idempotency-aware retries with jittered backoff, 401 refresh-and-replay, client-side rate and concurrency limiting, timeouts, abort signals, hooks and logger.
- Async-iterator pagination (`iterate`, `listAll`).
- Invoices: status actions, approvals, email and bulk email, reminders, payments, credits, payment links, templates, attachments, comments, PDF and bulk PDF, upsert by custom field.
- E-invoicing (India IRP / UAE) for invoices and credit notes, plus `canCancelIrn()`.
- India GST toolkit (`zoho-books-sdk/gst`): states, GSTIN checksum, HSN/SAC validation, supply-type detection, `computeGst`, `GstTaxResolver`.
- `books.gst.createInvoice()` / `createCreditNote()` with automatic place of supply and tax selection.
- Webhook signature verification.

### Added from a production GST invoicing integration
- `InvoiceWorkflow`: contact, invoice, payment, IRP push and email for one paid order, resumable from saved ids, with hold rules, a ₹0.05 total tolerance and `nextRetryAt` backoff.
- `settle()` returns `{ success, data }` or `{ success: false, code }` instead of throwing.
- `cacheTokenStore()`: shared token cache with a SET NX EX refresh lock across processes. Cache outages fall back to a direct refresh.
- `ZohoOAuth.parseCallback()` and `exchangeCode(..., callback)` for users in other data centers, with `allowedDataCenters`.
- `invoices.findByReference()` and `contacts.findByEmail()` adopt exact matches only.
- `validateBillingProfile()`, `gstTreatmentOf()`, `toZohoDate()` (India time), `isRetiredStateCode()`, `books.testConnection()`.

### Changed before first release
- Andhra Pradesh uses Zoho's code `AD`. Retired prefixes 25 and 28 and code `DD` are refused for new data, but accepted on old GSTINs.
- Intra state CGST plus SGST groups are sent in `tax_group_id`; IGST stays in `tax_id`. `GstTaxResolver.resolve` returns `{ id, field }`.
- The GST helper refuses a GSTIN on consumer, unregistered and overseas invoices, checks the place of supply against the GSTIN state, and requires `exportMode` for overseas customers.
- `computeGst` works in whole paise internally.
- Default request timeout is 20 s.
- Every resource method takes `CallOptions` as its last argument, with `query` for extra parameters. `get(id, opts)`, `create(data, opts)`, `iterate(params, { limit, ...opts })`.
- Input and filter types are strict. Custom field filters use the `cf_` prefix.
- Each module's type only exposes the document endpoints Zoho has. Calling a missing one rejects with `ZohoConfigError`.
- `withOrganization()` returns one cached client per organization, each with its own rate limiter.
- Removed `print()`, which duplicated `pdf()`.

### Fixed before first release
- `roundMoney` drifted by a paisa or more on amounts of ₹50 lakh and above.
- The access token was visible on logged errors.
- An empty id reached list or bulk endpoints. It now rejects before any request.
- `chartOfAccounts.listTransactions` used a wrong path.
- `AbortSignal` is honoured during retry back off and in the rate limiter queue.
- The GST helper reloads taxes once when a rate is missing from its cache.
- Local `npm publish` failed because `publishConfig` required provenance.
- The User Agent version now comes from `package.json` at build time.
