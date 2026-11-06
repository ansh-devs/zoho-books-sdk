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

### Changed before first release
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
