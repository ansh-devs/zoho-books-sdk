import { ZohoNetworkError, ZohoOAuthError } from '../errors.js';
import { DATA_CENTERS, dataCenterFromUrl, resolveDataCenter, type DataCenter } from '../datacenters.js';
import type { FetchLike } from '../http/types.js';

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  /** Data center of the Zoho account. Defaults to us. */
  dataCenter?: DataCenter;
  /** Accounts server URL. Overrides dataCenter. */
  accountsUrl?: string;
  /** Send token parameters in the form body (default) or the query string, as Zoho docs show. */
  tokenParamsIn?: 'body' | 'query';
  /** Data centers whose users may sign in. Each needs Multi DC enabled for this client in the Zoho API console. */
  allowedDataCenters?: DataCenter[];
  fetch?: FetchLike;
}

/** Values Zoho adds to the redirect after consent. */
export interface OAuthCallback {
  code?: string;
  state?: string;
  error?: string;
  /** User's data center location, e.g. in or eu. */
  location?: string;
  /** Accounts server of the user's data center. Exchange the code there. */
  accountsServer?: string;
}

/** Tokens plus the data center they belong to. Store dataCenter with the refresh token. */
export interface ExchangedTokens extends TokenResponse {
  accountsServer: string;
  dataCenter: DataCenter | undefined;
}

export interface AuthorizationUrlOptions {
  /** Scopes such as ZohoBooks.invoices.ALL. */
  scopes: string[];
  redirectUri: string;
  /** offline (default) returns a refresh token on first consent. */
  accessType?: 'offline' | 'online';
  /** consent forces the consent screen, needed for a new refresh token. */
  prompt?: 'consent';
  state?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  api_domain?: string;
  token_type?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

/** Zoho Accounts OAuth: consent URL, code exchange, refresh, revoke. */
export class ZohoOAuth {
  readonly accountsUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: FetchLike;
  private readonly paramsIn: 'body' | 'query';
  private readonly allowed: ReadonlySet<DataCenter> | undefined;

  constructor(options: OAuthClientOptions) {
    this.allowed = options.allowedDataCenters ? new Set(options.allowedDataCenters) : undefined;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.paramsIn = options.tokenParamsIn ?? 'body';
    this.accountsUrl = (options.accountsUrl ?? resolveDataCenter(options.dataCenter).accountsUrl).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  authorizationUrl(options: AuthorizationUrlOptions): string {
    const url = new URL(`${this.accountsUrl}/oauth/v2/auth`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('scope', options.scopes.join(','));
    url.searchParams.set('redirect_uri', options.redirectUri);
    url.searchParams.set('access_type', options.accessType ?? 'offline');
    if (options.prompt) url.searchParams.set('prompt', options.prompt);
    if (options.state) url.searchParams.set('state', options.state);
    return url.toString();
  }

  /** Read code, state, location and accounts server from the redirect URL or its query. */
  static parseCallback(input: string | URL | URLSearchParams | Record<string, string | undefined>): OAuthCallback {
    const params =
      input instanceof URLSearchParams
        ? input
        : typeof input === 'string' || input instanceof URL
          ? new URL(String(input), 'http://localhost').searchParams
          : new URLSearchParams(Object.entries(input).filter((e): e is [string, string] => e[1] !== undefined));
    const pick = (k: string) => params.get(k) ?? undefined;
    return {
      code: pick('code'),
      state: pick('state'),
      error: pick('error'),
      location: pick('location'),
      accountsServer: pick('accounts-server'),
    };
  }

  /** Exchange a grant code. Pass the callback's accountsServer so users of any allowed data center can sign in. */
  async exchangeCode(code: string, redirectUri?: string, callback: { accountsServer?: string } = {}): Promise<ExchangedTokens> {
    const accountsServer = this.checkAccountsServer(callback.accountsServer);
    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };
    if (redirectUri) params.redirect_uri = redirectUri;
    const tokens = await this.tokenRequest(params, accountsServer);
    return { ...tokens, accountsServer, dataCenter: dataCenterFromUrl(accountsServer) };
  }

  /** Validate a callback's accounts server against known Zoho hosts and the allowed data centers. */
  private checkAccountsServer(server: string | undefined): string {
    if (!server) return this.accountsUrl;
    const dc = dataCenterFromUrl(server);
    if (!dc || new URL(server).protocol !== 'https:' || DATA_CENTERS[dc].accountsUrl !== new URL(server).origin) {
      throw new ZohoOAuthError(`Unknown Zoho accounts server "${server}"`, { status: 0, oauthError: 'invalid_accounts_server' });
    }
    if (this.allowed && !this.allowed.has(dc)) {
      throw new ZohoOAuthError(
        `This account is in the ${dc} data center, which this client does not allow. Enable Multi DC for ${dc} in the Zoho API console and add it to allowedDataCenters.`,
        { status: 0, oauthError: 'data_center_not_allowed' },
      );
    }
    return DATA_CENTERS[dc].accountsUrl;
  }

  refresh(refreshToken: string): Promise<TokenResponse> {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
  }

  /** Self Client client_credentials grant. Experimental for Books; soid is ZohoBooks.<organization_id>. */
  clientCredentials(scopes: string[], soid?: string): Promise<TokenResponse> {
    const params: Record<string, string> = {
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: scopes.join(','),
    };
    if (soid) params.soid = soid;
    return this.tokenRequest(params);
  }

  /** Revoke a refresh token and every access token it minted. */
  async revoke(refreshToken: string): Promise<void> {
    const url = `${this.accountsUrl}/oauth/v2/token/revoke?token=${encodeURIComponent(refreshToken)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'POST' });
    } catch (cause) {
      throw new ZohoNetworkError('Network error revoking Zoho token', { status: 0, cause });
    }
    if (!res.ok) {
      throw new ZohoOAuthError(`Token revoke failed with HTTP ${res.status}`, { status: res.status });
    }
  }

  private async tokenRequest(params: Record<string, string>, accountsUrl = this.accountsUrl): Promise<TokenResponse> {
    const encoded = new URLSearchParams(params).toString();
    const url = `${accountsUrl}/oauth/v2/token${this.paramsIn === 'query' ? `?${encoded}` : ''}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: this.paramsIn === 'query' ? null : encoded,
      });
    } catch (cause) {
      throw new ZohoNetworkError('Network error calling Zoho token endpoint', {
        status: 0,
        method: 'POST',
        path: '/oauth/v2/token',
        cause,
      });
    }

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // Handled by the check below.
    }

    // Zoho reports OAuth failures as HTTP 200 with an error field.
    if (!res.ok || typeof body.error === 'string' || typeof body.access_token !== 'string') {
      const oauthError = typeof body.error === 'string' ? body.error : undefined;
      throw new ZohoOAuthError(
        `Zoho OAuth token request failed: ${oauthError ?? `HTTP ${res.status}`}${
          oauthError === 'invalid_code'
            ? ' (refresh token or grant code is invalid, expired or revoked, or the data center is wrong)'
            : oauthError === 'invalid_client'
              ? ' (wrong client id or secret, or Multi DC is not enabled for this data center in the Zoho API console)'
              : ''
        }`,
        { status: res.status, body, method: 'POST', path: '/oauth/v2/token', oauthError },
      );
    }
    return body as unknown as TokenResponse;
  }
}
