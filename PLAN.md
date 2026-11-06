# zoho-books-sdk — Research & Plan

A production-grade, type-safe Node.js SDK for the **Zoho Books API v3**, with
first-class **India GST / e-invoicing** support, published to npm as
[`@ansh-devs/zoho-books-sdk`](https://www.npmjs.com/package/@ansh-devs/zoho-books-sdk).

This document records the research behind the SDK, the design decisions, what
v0.1 ships, and the roadmap.

---

## 1. Why this SDK exists

Zoho ships official SDKs for CRM, but **none for Books**. Every team that
invoices through Zoho Books (especially in India, where GST adds a layer of
rules on top) ends up hand-writing the same plumbing: OAuth refresh, data-center
URLs, `organization_id`, pagination, rate limits, error envelopes, and GST
tax-selection logic. That code is subtle and easy to get wrong.

## 2. Research: the existing ecosystem

We reviewed 16 community packages from npm (source read from tarballs), plus
Zoho's own CRM SDK for reference patterns.

| Package | Status | Takeaway |
|---|---|---|
| `@trieb.work/zoho-ts` | abandoned (2023) | `client_credentials` once, **never refreshes**; non-zero `code` on HTTP 200 only `console.error`'d; `hsn_or_sac` typed as number |
| `@getyetty-sdk/zohobooks` | auto-generated | Generated from Zoho's **official OpenAPI bundle**; broad (≈880 ops) but flat functions, `organization_id` on every call, token manager not wired in, no retries, enums typed as `string`, wrong Canada accounts host |
| `@finopsbricks/fob-zb` | new (2026) | Good: treats `{error}`-on-200 from token endpoint as failure, adopts `api_domain`. Bad: **concurrent calls can both refresh**, no 5xx retries, no GST |
| `@dipakparmar/zoho-billing` | new (Billing, not Books) | Best ergonomics: typed error hierarchy, async iterators, pluggable token store, jittered backoff. But **retries POSTs on 5xx** (duplicate documents) |
| `@wanasapps/zoho-auth` + `zoho-api` | active | Most complete DC table; idempotency-aware retries; refuses to send tokens to non-Zoho hosts. No in-process refresh de-dupe |
| `@zohocrm/typescript-sdk-8.0` (official, CRM) | active | Pluggable `TokenStore`; but a **global singleton** user switch (unsafe for multi-tenant servers) and heavy deps |
| `zoho-books-js`, `zohobooks-sdk`, `zbooksdkmiblu`, `zoho-books`, n8n / Pipedream / Activepieces pieces, MCP servers | mixed / stale | Hard-coded DCs, wrong AU/CN hosts, errors resolved as data, `client_secret` in browsers, **one package ships what look like live credentials** |

### Recurring flaws we design against

1. Incomplete / wrong data-center tables (Canada uses `accounts.zohocloud.ca`; `.ae`, `.sa`, `.com.cn` often missing; silent fallback to `.com`).
2. No single-flight token refresh → refresh stampedes. Zoho allows only **10 access tokens / 10 min per refresh token** and **15 active**, so this causes real outages.
3. Ignoring non-zero `code` in HTTP 200 responses.
4. No error hierarchy (can't distinguish rate-limit vs auth vs validation).
5. Retries that ignore idempotency (POST retried after 5xx/timeout ⇒ duplicate invoices).
6. No pagination iterator, or unbounded eager fetching.
7. No PDF / binary support; rare multipart support.
8. GST barely modelled; **no e-invoice (IRN) workflow** in any hand-written SDK.
9. Credential hygiene problems.
10. Loose typing (`any`) and no tests.

### What the official API actually specifies (verified against docs)

- **Official OpenAPI bundle exists:** `https://www.zoho.com/books/api/v3/openapi-all.zip` (45 module files, ~616 paths, ~885 operations). Useful but loose: few enums, **no error responses**, server fixed to `.com`, schema duplication, some wrong paths. We used it to verify every path and response key in this SDK.
- **Auth:** OAuth 2.0; header `Authorization: Zoho-oauthtoken <token>`; access tokens live 1 h; refresh tokens don't expire (max 20 per user, oldest silently deleted). Token endpoint reports failures as **HTTP 200 + `{ "error": "invalid_code" }`**.
- **Data centers:** US, EU, IN, AU, JP, CA (`zohocloud.ca` accounts host), CN, SA, AE. Token responses include `api_domain`.
- **Limits:** 100 req/min per org; daily 1,000 (Free) → 10,000 (Premium+); concurrency 5 (Free) / 10 (paid). All return **HTTP 429**, distinguished by Zoho code: **44** per-minute, **45** daily, **1070** concurrency. No `Retry-After` documented.
- **Envelope:** `{ code, message, <resource> }`, `code === 0` is success; `1002` = record does not exist. Bulk endpoints return per-id `errors`.
- **Pagination:** `page`, `per_page` (max 200), `page_context.has_more_page`.
- **Upsert:** `PUT /invoices` (also contacts, estimates…) with `X-Unique-Identifier-Key` / `X-Unique-Identifier-Value` / `X-Upsert: true` — the only documented safe-retry mechanism.
- **Bulk limits:** PDF/print 25 ids, email/reminders 10 ids.
- **India GST fields:** `gst_treatment` (documented: `business_gst`, `business_none`, `overseas`, `consumer`), `gst_no`, `place_of_supply` / `place_of_contact` (2-letter state codes), `hsn_or_sac`, `tax_id` (IGST tax or CGST+SGST group), `item_tax_preferences` (`intra` / `inter`), `tax_specific_type` (`igst`, `cgst`, `sgst`, `nil`, `cess`), `is_reverse_charge_applied`, `source_of_supply` / `destination_of_supply` on bills.
- **E-invoicing (IRP) is in the API:** push / cancel / fetch / get / mark-pushed / mark-cancelled / recall / delete-status, for invoices and credit notes, single and bulk. IRN can be cancelled only within **24 h**.
- **Not in the API:** e-way bills (UI only), GSTR filing, reports, webhook registration.
- **Webhooks:** configured in the UI; optional secret ⇒ header `X-Zoho-Webhook-Signature` = `base64(HMAC-SHA256(secret, sorted(key+value…) + rawJsonBody))`. 10 s read timeout; failed deliveries are retried (receivers must be idempotent).

## 3. Design goals

| Goal | How |
|---|---|
| Seamless API | `books.invoices.create()`, `books.invoices.einvoice.push()`, `for await (const inv of books.invoices.iterate())` |
| Correct by default | Never retry non-idempotent writes after 5xx/timeouts; always surface non-zero `code`; never fall back to the wrong DC |
| Safe at scale | Single-flight refresh, shared `TokenStore` with optional distributed lock, client-side rate + concurrency limiting per org |
| GST-native | Pure validators (GSTIN checksum, HSN/SAC, states) and an invoice helper that picks place of supply and CGST+SGST vs IGST tax ids |
| Type-safe but forward compatible | Strong types for known fields; loose string unions and index signatures so new Zoho fields / editions don't break builds |
| Zero dependencies | Native `fetch`, `FormData`, `Blob`, `AbortSignal`, `node:crypto` (Node ≥ 18.17) |
| Escape hatch | `books.request()` for any of the ~900 operations without a typed wrapper |
| Publishable | Dual ESM/CJS, `.d.ts` + `.d.cts`, `exports` map, `/gst` sub-path, verified with `publint` and `@arethetypeswrong/cli`, npm provenance |

## 4. Architecture

```
ZohoBooks (client.ts)
├── auth/            AuthProvider ← RefreshTokenAuth | ClientCredentialsAuth | StaticTokenAuth | custom
│                    ZohoOAuth (consent URL, code exchange, refresh, revoke)
│                    TokenStore (MemoryTokenStore | your Redis/DB, optional withLock)
├── http/            HttpClient: URL + organization_id, auth header, JSON/multipart/binary,
│                    envelope → typed errors, retry policy, 401 refresh-and-replay,
│                    timeouts, hooks, logger, api_domain following (Zoho hosts only)
│                    RateLimiter: sliding-window RPM + concurrency cap + global pause on 429
├── resources/       BaseResource → CrudResource → DocumentResource (pdf, email, comments,
│                    attachments, approvals, addresses, upsert, bulk delete)
│                    InvoicesResource (+ EInvoiceApi), sales, purchases, accounting, settings
├── gst/             (pure, also exported as `@ansh-devs/zoho-books-sdk/gst`)
│                    states, GSTIN/HSN validation, supply type, computeGst, GstTaxResolver, IRN window
├── gst-helper.ts    GstInvoiceHelper: books.gst.createInvoice({ gstRate }) → correct tax ids
├── webhooks.ts      verifyWebhookSignature / computeWebhookSignature
└── errors.ts        ZohoBooksError hierarchy
```

### Key decisions

- **Retry policy.** GET/PUT/DELETE retry on 5xx, network errors and timeouts with full-jitter exponential backoff. **POST does not** (Zoho has no idempotency keys), unless the call is marked `idempotent`. **429s are always retried** (rejected before processing) except the **daily quota (45)**, which fails fast with `kind: 'daily'`. A 401 triggers exactly one refresh-and-replay.
- **Rate limiting per org.** Limits are per organization, so each `withOrganization()` client gets its own limiter while sharing auth and the token cache.
- **Response-key drift tolerance.** The spec and the live API disagree on some keys (`customerpayments` vs `customer_payments`; chart of accounts returns a flat object). Resources try configured keys, then aliases, then fall back safely.
- **GST helper is opt-in and local-first.** It validates *before* any write (`ZohoGstError`, no request sent), caches org + taxes, and respects explicit `tax_id`s and a `taxMap` override.
- **`api_domain` following** happens only when the caller didn't pin a host, and only to `*.zohoapis.*` hosts (token exfiltration guard).

## 5. What v0.1 ships

- Auth: refresh-token, client-credentials (experimental for Books), static token, custom providers; consent URL / code exchange / revoke; pluggable token store with lock; `onTokenRefreshed`.
- All 10 data centers, `fromEnv()`, `withOrganization()`, `request()` escape hatch.
- Resources (31): organizations, contacts (+ persons, addresses, statements), items, taxes (+ groups), currencies, users, locations, projects, time entries, estimates, sales orders, invoices, recurring invoices, retainer invoices, credit notes, debit notes, sales receipts, delivery challans, customer payments, bills, recurring bills, purchase orders, vendor credits, vendor payments, expenses, recurring expenses, chart of accounts, journals, bank accounts, bank transactions.
- Invoices: CRUD, status (sent/void/draft/write-off), approvals, email (single + bulk chunked by 10), reminders, payments, credits, payment links, templates, attachments, comments, PDF (single + bulk chunked by 25), upsert, from-sales-order.
- E-invoicing for invoices and credit notes; `canCancelIrn()` 24 h guard.
- GST toolkit and `books.gst.createInvoice()` / `createCreditNote()`.
- Webhook signature verification.
- 120 unit tests against a scripted fetch (no network), including one regression test per audit finding and the cases from a production GST integration; package checks with `publint` + `attw`.

## 6. Roadmap

| Version | Scope |
|---|---|
| 0.2 | Codegen raw request/response types from the official OpenAPI bundle (merged, with enum corrections), kept in CI against the spec hash; typed wrappers for remaining modules (custom modules, fixed assets, reporting tags, price lists, purchase returns, self-billed invoices, bank rules, base-currency adjustments, opening balances, transaction locking) |
| 0.3 | `@ansh-devs/zoho-books-sdk/testing`: fakes and fixtures; a contract-test suite runnable against a real Zoho sandbox org (opt-in via env); verify the undocumented `gst_treatment` values and state codes (`OD`/`OR`, `TS`, `UK`, `LA`) against a live India org |
| 0.4 | Redis `TokenStore` + lock recipe package; OpenTelemetry hooks; `Idempotency` helper (look up by `reference_number` / custom field before create); daily-quota budget tracker |
| 0.5 | E-invoice payload builder/validator mirroring NIC IRP schema; webhook payload types per module; CLI (`npx @ansh-devs/zoho-books-sdk auth` to mint a refresh token) |
| 1.0 | API freeze, docs site (TypeDoc), semantic-release with npm provenance |

## 7. Publishing to npm

- Published as `@ansh-devs/zoho-books-sdk`. npm refused the unscoped `zoho-books-sdk` as too similar to the existing `zohobooks-sdk`. Clearly marked **unofficial** in the README.
- `npm run check` = typecheck + tests + build + `publint` + `attw`; it runs automatically on `prepublishOnly`.
- Releases are automated with semantic-release: merging `develop` into `master` versions from Conventional Commits, publishes to npm with provenance, tags and writes the GitHub release.
- SemVer; release notes on GitHub Releases.

## 8. Open questions / to verify against a live org

- Extra India `gst_treatment` values (`business_sez`, `deemed_export`, `business_registered_composition`, `tax_deductor`, `tax_collector`) exist in the UI, but their API names are not documented. They're accepted as plain strings.
- State codes are now verified in production: Andhra Pradesh is `AD` and Uttarakhand is `UK`. Odisha, Telangana and Ladakh use `OD`, `TS` and `LA` in that integration's map. `setStateCodeOverrides()` remains for edge cases.
- Zoho's OpenAPI spec lists only `tax_id` on line items, but the production integration sends CGST+SGST groups in `tax_group_id`. The SDK follows production.
- Request bodies for bulk e-invoice push/cancel and IRN cancel reason fields (passed through as-is).
- Whether Books accepts `client_credentials` with `soid=ZohoBooks.<org_id>`.

## Sources

- Zoho Books API v3 reference — https://www.zoho.com/books/api/v3/introduction/ (and `/oauth/`, `/errors/`, `/pagination/`, `/invoices/`)
- Official OpenAPI bundle — https://www.zoho.com/books/api/v3/openapi-all.zip
- Zoho Accounts OAuth — https://www.zoho.com/accounts/protocol/oauth.html
- E-invoicing functions — https://www.zoho.com/in/books/help/e-invoicing/functions-einvoice.html
- E-way bill functions — https://www.zoho.com/in/books/help/e-way-bill/functions.md
- Webhooks — https://www.zoho.com/in/books/help/settings/automation/workflow-actions/webhooks.html
- GST import format — https://www.zoho.com/in/books/kb/gst/gst-import-format.html
- Community: "API documentation for GST ready features" — https://help.zoho.com/portal/en/community/topic/api-documentation-for-gst-ready-features-in-zoho-books
- Community: "OpenAPI Specs are just plain wrong" — https://help.zoho.com/portal/en/community/topic/openapi-specs-are-just-plain-wrong
