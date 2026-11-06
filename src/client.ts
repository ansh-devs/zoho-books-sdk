import { RefreshTokenAuth, StaticTokenAuth, type AuthProvider } from './auth/providers.js';
import type { StoredToken, TokenStore } from './auth/token-store.js';
import { BOOKS_API_PATH, resolveDataCenter, type DataCenter } from './datacenters.js';
import { ZohoConfigError } from './errors.js';
import { GstInvoiceHelper, type GstHelperOptions } from './gst-helper.js';
import { HttpClient, type RetryOptions } from './http/http-client.js';
import type { RateLimiterOptions } from './http/rate-limiter.js';
import type { BinaryResponse, CallOptions, FetchLike, Hooks, Logger, RequestOptions } from './http/types.js';
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
  type BillsApi,
  type PurchaseOrdersApi,
  type VendorCreditsApi,
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
  type CreditNotesApi,
  type DeliveryChallansApi,
  type EstimatesApi,
  type RetainerInvoicesApi,
  type SalesOrdersApi,
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
  type LocationsApi,
} from './resources/settings.js';

export interface ZohoBooksOptions {
  /** Organization to work on. Every call except organizations.list needs one. */
  organizationId?: string;
  /** Data center of the Zoho account. Default us. India is in. */
  dataCenter?: DataCenter;
  /** API domain such as https://www.zohoapis.in */
  apiDomain?: string;
  /** Full Books base URL including /books/v3, for a proxy or mock server. */
  baseUrl?: string;
  /** Accounts server URL. */
  accountsUrl?: string;

  /** Custom auth provider. */
  auth?: AuthProvider;
  /** Fixed access token that is never refreshed. */
  accessToken?: string;
  /** OAuth client id, used with clientSecret and refreshToken. */
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  /** Token cache shared across processes, such as Redis. Default is memory. */
  tokenStore?: TokenStore;
  onTokenRefreshed?: (token: StoredToken) => void;

  /** Timeout per request. Default 20 s. */
  timeoutMs?: number;
  retry?: RetryOptions;
  /** Throttling per organization. Default 100 per minute and 10 at once. false disables it. */
  rateLimit?: RateLimiterOptions | false;
  fetch?: FetchLike;
  hooks?: Hooks;
  logger?: Logger;
  userAgent?: string;

  /** India GST helper settings. */
  gst?: GstHelperOptions;
}

/** Zoho Books API v3 client for one organization. */
export class ZohoBooks {
  readonly http: HttpClient;
  readonly auth: AuthProvider;
  private readonly options: ZohoBooksOptions;
  private readonly orgClients = new Map<string, ZohoBooks>();

  readonly contacts: ContactsResource;
  readonly items: ItemsResource;
  readonly estimates: EstimatesApi;
  readonly salesOrders: SalesOrdersApi;
  readonly invoices: InvoicesResource;
  readonly recurringInvoices: RecurringInvoicesResource;
  readonly retainerInvoices: RetainerInvoicesApi;
  readonly creditNotes: CreditNotesApi;
  readonly debitNotes: DebitNotesResource;
  readonly salesReceipts: SalesReceiptsResource;
  readonly deliveryChallans: DeliveryChallansApi;
  readonly customerPayments: CustomerPaymentsResource;
  readonly bills: BillsApi;
  readonly recurringBills: RecurringBillsResource;
  readonly purchaseOrders: PurchaseOrdersApi;
  readonly vendorCredits: VendorCreditsApi;
  readonly vendorPayments: VendorPaymentsResource;
  readonly expenses: ExpensesResource;
  readonly recurringExpenses: RecurringExpensesResource;
  readonly chartOfAccounts: ChartOfAccountsResource;
  readonly journals: JournalsResource;
  readonly bankAccounts: BankAccountsResource;
  readonly bankTransactions: BankTransactionsResource;
  readonly organizations: OrganizationsResource;
  readonly taxes: TaxesResource;
  readonly currencies: CurrenciesResource;
  readonly users: UsersResource;
  readonly locations: LocationsApi;
  readonly projects: ProjectsResource;
  readonly timeEntries: TimeEntriesResource;
  /** India GST invoicing. */
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
      // Trust the token's api_domain only when the caller pinned no host.
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
    const creditNotes = new CreditNotesResource(http);
    this.creditNotes = creditNotes;
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
        creditNotes,
        organizationId: () => this.http.organizationId,
      },
      options.gst,
    );
  }

  get organizationId(): string | undefined {
    return this.http.organizationId;
  }

  /** Client for another organization, created once and reused. It shares auth and keeps its own rate limiter. */
  withOrganization(organizationId: string): ZohoBooks {
    if (organizationId === this.organizationId) return this;
    let client = this.orgClients.get(organizationId);
    if (!client) {
      client = new ZohoBooks({ ...this.options, auth: this.auth, organizationId });
      this.orgClients.set(organizationId, client);
    }
    return client;
  }

  /** Check credentials, data center and organization id in one call. Returns the organization name. */
  async testConnection(opts?: CallOptions): Promise<{ organizationId: string; name: string }> {
    const orgId = opts?.organizationId ?? this.organizationId;
    if (!orgId) throw new ZohoConfigError('organizationId is not set');
    const org = await this.organizations.get(orgId, opts);
    return { organizationId: org.organization_id ?? orgId, name: org.name };
  }

  /** Call any endpoint without a typed wrapper. path is relative to /books/v3. */
  request<T = Record<string, unknown>>(options: RequestOptions & { responseType?: 'json' }): Promise<T>;
  request(options: RequestOptions & { responseType: 'binary' }): Promise<BinaryResponse>;
  request(options: RequestOptions): Promise<unknown> {
    return this.http.request(options as RequestOptions & { responseType?: 'json' });
  }

  /** Client from ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORGANIZATION_ID and ZOHO_DATA_CENTER. */
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
    throw new ZohoConfigError('No credentials: pass { clientId, clientSecret, refreshToken }, { accessToken } or a custom { auth } provider');
  }
}
