export { ZohoBooks, type ZohoBooksOptions } from './client.js';

// Auth
export { ZohoOAuth, type OAuthClientOptions, type AuthorizationUrlOptions, type TokenResponse } from './auth/oauth.js';
export {
  RefreshTokenAuth,
  ClientCredentialsAuth,
  StaticTokenAuth,
  type AuthProvider,
  type RefreshTokenAuthOptions,
  type ClientCredentialsAuthOptions,
} from './auth/providers.js';
export { MemoryTokenStore, type TokenStore, type StoredToken } from './auth/token-store.js';
export { scope, Scopes, SCOPE_MODULES, type ScopeModule, type ScopeOperation } from './scopes.js';

// Data centers
export { DATA_CENTERS, BOOKS_API_PATH, resolveDataCenter, dataCenterFromUrl, type DataCenter, type DataCenterEndpoints } from './datacenters.js';

// Errors
export {
  ZohoBooksError,
  ZohoValidationError,
  ZohoAuthenticationError,
  ZohoPermissionError,
  ZohoNotFoundError,
  ZohoRequestError,
  ZohoRateLimitError,
  ZohoServerError,
  ZohoNetworkError,
  ZohoTimeoutError,
  ZohoOAuthError,
  ZohoGstError,
  ZohoConfigError,
  type RateLimitKind,
  type ZohoErrorDetails,
} from './errors.js';

// Transport
export { HttpClient, type HttpClientOptions, type RetryOptions } from './http/http-client.js';
export { RateLimiter, type RateLimiterOptions } from './http/rate-limiter.js';
export type {
  FetchLike,
  HttpMethod,
  Query,
  QueryValue,
  RequestOptions,
  CallOptions,
  BinaryResponse,
  Hooks,
  Logger,
  RequestEvent,
  ResponseEvent,
  RetryEvent,
} from './http/types.js';
export { paginate, collect, MAX_PAGE_SIZE, type ListResult, type PageContext, type IterateOptions, type PaginationParams } from './pagination.js';

// Resources (for typing and extension)
export { BaseResource, CrudResource, extractList, extractOne, type ResourceConfig, type ZohoEnvelope, type ListParams } from './resources/base.js';
export { DocumentResource, type UploadFile, type UpsertOptions, type BulkResult } from './resources/document.js';
export { EInvoiceApi } from './resources/einvoice.js';
export { InvoicesResource, type CreateInvoiceOptions, type ApplyCreditsInput } from './resources/invoices.js';
export { ContactsResource, ContactPersonsResource } from './resources/contacts.js';
export * from './resources/sales.js';
export * from './resources/purchases.js';
export * from './resources/accounting.js';
export * from './resources/settings.js';

// GST
export { GstInvoiceHelper, homeStateFromOrganization, type GstHelperOptions, type GstLineItem, type GstDocumentInput, type PreparedGstDocument } from './gst-helper.js';
export * from './gst/index.js';

// Webhooks
export { verifyWebhookSignature, computeWebhookSignature, WEBHOOK_SIGNATURE_HEADER, type WebhookSignatureInput } from './webhooks.js';

// Models
export type * from './types/common.js';
export type * from './types/models.js';
