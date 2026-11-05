import { RefreshTokenAuth, StaticTokenAuth, type AuthProvider } from './auth/providers.js';
import type { StoredToken, TokenStore } from './auth/token-store.js';
import { BOOKS_API_PATH, resolveDataCenter, type DataCenter } from './datacenters.js';
import { ZohoConfigError } from './errors.js';
import { GstInvoiceHelper, type GstHelperOptions } from './gst-helper.js';
import { HttpClient, type RetryOptions } from './http/http-client.js';
import type { RateLimiterOptions } from './http/rate-limiter.js';
import type { BinaryResponse, FetchLike, Hooks, Logger, RequestOptions } from './http/types.js';
import { BankAccountsResource, BankTransactionsResource, ChartOfAccountsResource, JournalsResource } from './resources/accounting.js';
import { ContactsResource } from './resources/contacts.js';
import { InvoicesResource } from './resources/invoices.js';
import {
  BillsResource,
  ExpensesResource,
  PurchaseOrdersResource,
  RecurringBillsResource,
  RecurringExpensesResource,
  VendorCreditsResource,
  VendorPaymentsResource,
} from './resources/purchases.js';
import {
  CreditNotesResource,
  CustomerPaymentsResource,
  DebitNotesResource,
  DeliveryChallansResource,
  EstimatesResource,
  RecurringInvoicesResource,
  RetainerInvoicesResource,
  SalesOrdersResource,
  SalesReceiptsResource,
} from './resources/sales.js';
import {
  CurrenciesResource,
  ItemsResource,
  LocationsResource,
  OrganizationsResource,
  ProjectsResource,
  TaxesResource,
  TimeEntriesResource,
  UsersResource,
} from './resources/settings.js';

export interface ZohoBooksOptions {
  /** Organization to operate on. Required for everything except `organizations.list()`. */
  organizationId?: string;
  /** Data center of the Zoho account. Default `us`. India is `in`. */
  dataCenter?: DataCenter;
  /** Override the API domain, e.g. `https://www.zohoapis.in`. */
  apiDomain?: string;
  /** Override the full Books base URL (including `/books/v3`), e.g. for a proxy or mock server. */
  baseUrl?: string;
  /** Override the accounts (OAuth) server URL. */
  accountsUrl?: string;

  // ── auth (pick one) ──
  /** Custom auth provider. */
  auth?: AuthProvider;
  /** Fixed access token (no refresh). */
  accessToken?: string;
  /** OAuth client id (with `clientSecret` + `refreshToken`). */
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  /** Token cache shared across processes (Redis, DB...). Default in-memory. */
  tokenStore?: TokenStore;
  onTokenRefreshed?: (token: StoredToken) => void;

  // ── transport ──
  /** Per-request timeout. Default 30 s. */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Client-side throttling (default 100 req/min, 10 concurrent). `false` disables. */
  rateLimit?: RateLimiterOptions | false;
  fetch?: FetchLike;
  hooks?: Hooks;
  logger?: Logger;
  userAgent?: string;

  /** India GST helper settings. */
  gst?: GstHelperOptions;
}

/**
 * Zoho Books API v3 client.
 *
 * ```ts
 * const books = new ZohoBooks({
 *   dataCenter: 'in',
 *   organizationId: process.env.ZOHO_ORG_ID,
 *   clientId: process.env.ZOHO_CLIENT_ID,
 *   clientSecret: process.env.ZOHO_CLIENT_SECRET,
 *   refreshToken: process.env.ZOHO_REFRESH_TOKEN,
 * });
 * const invoice = await books.invoices.get('123');
 * ```
 */
export class ZohoBooks {
  readonly http: HttpClient;
  readonly auth: AuthProvider;
  private readonly options: ZohoBooksOptions;

  // Sales
  readonly contacts: ContactsResource;
  readonly items: ItemsResource;
  readonly estimates: EstimatesResource;
  readonly salesOrders: SalesOrdersResource;
  readonly invoices: InvoicesResource;
  readonly recurringInvoices: RecurringInvoicesResource;
  readonly retainerInvoices: RetainerInvoicesResource;
  readonly creditNotes: CreditNotesResource;
  readonly debitNotes: DebitNotesResource;
  readonly salesReceipts: SalesReceiptsResource;
  readonly deliveryChallans: DeliveryChallansResource;
  readonly customerPayments: CustomerPaymentsResource;
  // Purchases
  readonly bills: BillsResource;
  readonly recurringBills: RecurringBillsResource;
  readonly purchaseOrders: PurchaseOrdersResource;
  readonly vendorCredits: VendorCreditsResource;
  readonly vendorPayments: VendorPaymentsResource;
  readonly expenses: ExpensesResource;
  readonly recurringExpenses: RecurringExpensesResource;
  // Accounting & banking
  readonly chartOfAccounts: ChartOfAccountsResource;
  readonly journals: JournalsResource;
  readonly bankAccounts: BankAccountsResource;
  readonly bankTransactions: BankTransactionsResource;
  // Settings & org
  readonly organizations: OrganizationsResource;
  readonly taxes: TaxesResource;
  readonly currencies: CurrenciesResource;
  readonly users: UsersResource;
  readonly locations: LocationsResource;
  readonly projects: ProjectsResource;
  readonly timeEntries: TimeEntriesResource;
  /** India GST invoicing helpers. */
  readonly gst: GstInvoiceHelper;

  constructor(options: ZohoBooksOptions) {
    this.options = options;
    this.auth = ZohoBooks.buildAuth(options);

    const explicitHost = Boolean(options.baseUrl || options.apiDomain || options.dataCenter);
    const baseUrl =
      options.baseUrl ?? `${(options.apiDomain ?? resolveDataCenter(options.dataCenter).apiDomain).replace(/\/+$/, '')}${BOOKS_API_PATH}`;

    this.http = new HttpClient({
      baseUrl,
      auth: this.auth,
      organizationId: options.organizationId,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
      retry: options.retry,
      rateLimit: options.rateLimit,
      hooks: options.hooks,
      logger: options.logger,
      userAgent: options.userAgent,
      // If the caller didn't pin a host, trust the `api_domain` Zoho returns with the token.
      followTokenApiDomain: !explicitHost,
    });

    const http = this.http;
    this.contacts = new ContactsResource(http);
    this.items = new ItemsResource(http);
    this.estimates = new EstimatesResource(http);
    this.salesOrders = new SalesOrdersResource(http);
    this.invoices = new InvoicesResource(http);
    this.recurringInvoices = new RecurringInvoicesResource(http);
    this.retainerInvoices = new RetainerInvoicesResource(http);
    this.creditNotes = new CreditNotesResource(http);
    this.debitNotes = new DebitNotesResource(http);
    this.salesReceipts = new SalesReceiptsResource(http);
    this.deliveryChallans = new DeliveryChallansResource(http);
    this.customerPayments = new CustomerPaymentsResource(http);
    this.bills = new BillsResource(http);
    this.recurringBills = new RecurringBillsResource(http);
    this.purchaseOrders = new PurchaseOrdersResource(http);
    this.vendorCredits = new VendorCreditsResource(http);
    this.vendorPayments = new VendorPaymentsResource(http);
    this.expenses = new ExpensesResource(http);
    this.recurringExpenses = new RecurringExpensesResource(http);
    this.chartOfAccounts = new ChartOfAccountsResource(http);
    this.journals = new JournalsResource(http);
    this.bankAccounts = new BankAccountsResource(http);
    this.bankTransactions = new BankTransactionsResource(http);
    this.organizations = new OrganizationsResource(http);
    this.taxes = new TaxesResource(http);
    this.currencies = new CurrenciesResource(http);
    this.users = new UsersResource(http);
    this.locations = new LocationsResource(http);
    this.projects = new ProjectsResource(http);
    this.timeEntries = new TimeEntriesResource(http);
    this.gst = new GstInvoiceHelper(
      {
        organizations: this.organizations,
        taxes: this.taxes,
        contacts: this.contacts,
        invoices: this.invoices,
        creditNotes: this.creditNotes,
        organizationId: () => this.http.organizationId,
      },
      options.gst,
    );
  }

  /** Current organization id. */
  get organizationId(): string | undefined {
    return this.http.organizationId;
  }

  /**
   * A client bound to another organization that shares this client's auth
   * (and token cache). It gets its own rate limiter, since Zoho's limits are
   * per organization.
   */
  withOrganization(organizationId: string): ZohoBooks {
    return new ZohoBooks({ ...this.options, auth: this.auth, organizationId });
  }

  /**
   * Escape hatch for endpoints without a typed wrapper (the API has ~900
   * operations). Path is relative to `/books/v3`.
   *
   * ```ts
   * const res = await books.request({ method: 'GET', path: '/invoices/dashboard' });
   * ```
   */
  request<T = Record<string, unknown>>(options: RequestOptions & { responseType?: 'json' }): Promise<T>;
  request(options: RequestOptions & { responseType: 'binary' }): Promise<BinaryResponse>;
  request(options: RequestOptions): Promise<unknown> {
    return this.http.request(options as RequestOptions & { responseType?: 'json' });
  }

  /**
   * Build a client from environment variables:
   * `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`,
   * `ZOHO_ORGANIZATION_ID`, `ZOHO_DATA_CENTER` (or `ZOHO_ACCESS_TOKEN`).
   */
  static fromEnv(overrides: Partial<ZohoBooksOptions> = {}, env: Record<string, string | undefined> = process.env): ZohoBooks {
    const opts: ZohoBooksOptions = { ...overrides };
    const set = <K extends keyof ZohoBooksOptions>(key: K, value: ZohoBooksOptions[K] | undefined) => {
      if (value !== undefined && value !== '' && opts[key] === undefined) opts[key] = value;
    };
    set('clientId', env.ZOHO_CLIENT_ID);
    set('clientSecret', env.ZOHO_CLIENT_SECRET);
    set('refreshToken', env.ZOHO_REFRESH_TOKEN);
    set('accessToken', env.ZOHO_ACCESS_TOKEN);
    set('organizationId', env.ZOHO_ORGANIZATION_ID ?? env.ZOHO_ORG_ID);
    set('dataCenter', env.ZOHO_DATA_CENTER as DataCenter | undefined);
    return new ZohoBooks(opts);
  }

  private static buildAuth(o: ZohoBooksOptions): AuthProvider {
    if (o.auth) return o.auth;
    if (o.refreshToken || o.clientId || o.clientSecret) {
      const missing = (['clientId', 'clientSecret', 'refreshToken'] as const).filter((k) => !o[k]);
      if (missing.length) throw new ZohoConfigError(`Missing OAuth option(s): ${missing.join(', ')}`);
      return new RefreshTokenAuth({
        clientId: o.clientId!,
        clientSecret: o.clientSecret!,
        refreshToken: o.refreshToken!,
        ...(o.dataCenter ? { dataCenter: o.dataCenter } : {}),
        ...(o.accountsUrl ? { accountsUrl: o.accountsUrl } : {}),
        ...(o.fetch ? { fetch: o.fetch } : {}),
        ...(o.tokenStore ? { tokenStore: o.tokenStore } : {}),
        ...(o.onTokenRefreshed ? { onTokenRefreshed: o.onTokenRefreshed } : {}),
      });
    }
    if (o.accessToken) return new StaticTokenAuth(o.accessToken);
    throw new ZohoConfigError(
      'No credentials: pass { clientId, clientSecret, refreshToken }, { accessToken } or a custom { auth } provider',
    );
  }
}
