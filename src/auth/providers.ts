import { createHash } from 'node:crypto';
import { ZohoOAuthError } from '../errors.js';
import { SdkLogger } from '../logging/logger.js';
import { ZohoOAuth, type OAuthClientOptions, type TokenResponse } from './oauth.js';
import { MemoryTokenStore, type StoredToken, type TokenStore } from './token-store.js';

/** Supplies access tokens to the HTTP layer. */
export interface AuthProvider {
  /** A valid access token, refreshed if needed. */
  getAccessToken(): Promise<string>;
  /** Drop a token Zoho rejected with 401. Return true if a retry with a fresh token makes sense. */
  invalidate?(token: string): Promise<boolean> | boolean;
  /** api_domain reported with the current token. */
  getApiDomain?(): string | undefined;
}

/** A fixed access token. Never refreshes. */
export class StaticTokenAuth implements AuthProvider {
  constructor(private readonly accessToken: string) {}

  getAccessToken(): Promise<string> {
    return Promise.resolve(this.accessToken);
  }

  invalidate(): boolean {
    return false;
  }
}

interface CachingOptions {
  /** Token cache. Defaults to memory in this process. */
  tokenStore?: TokenStore;
  /** Cache key. Defaults to a hash of the client id and grant. */
  tokenStoreKey?: string;
  /** Refresh this many ms before expiry. Default 5 minutes. */
  refreshSkewMs?: number;
  /** Called after each new access token. */
  onTokenRefreshed?: (token: StoredToken) => void;
  /** SDK logger for refresh and cache events. Silent when omitted. */
  log?: SdkLogger;
}

/** Caches tokens and shares one refresh between concurrent callers, since Zoho allows 10 tokens per 10 minutes. */
abstract class CachingTokenAuth implements AuthProvider {
  private readonly store: TokenStore;
  private readonly key: string;
  private readonly skewMs: number;
  private readonly onTokenRefreshed: ((token: StoredToken) => void) | undefined;
  private inflight: Promise<StoredToken> | undefined;
  private apiDomain: string | undefined;
  private readonly log: SdkLogger;
  /** @internal test clock */
  now: () => number = Date.now;

  protected constructor(options: CachingOptions, defaultKeyMaterial: string) {
    this.store = options.tokenStore ?? new MemoryTokenStore();
    this.key =
      options.tokenStoreKey ??
      `zoho-books:${createHash('sha256').update(defaultKeyMaterial).digest('hex').slice(0, 24)}`;
    this.skewMs = options.refreshSkewMs ?? 5 * 60_000;
    this.onTokenRefreshed = options.onTokenRefreshed;
    this.log = options.log ?? SdkLogger.silent();
  }

  /** Report a cache failure. The SDK keeps going without the cache. */
  private cacheFailed(operation: string, error: unknown): void {
    this.log.warn('auth', 'zoho.token.cache_unavailable', `Token cache ${operation} failed; continuing without the cache`, {
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  protected abstract mint(): Promise<TokenResponse>;

  /** Read the cache. A cache outage counts as a miss so requests keep working. */
  private async cached(): Promise<StoredToken | undefined> {
    try {
      return await this.store.get(this.key);
    } catch (error) {
      this.cacheFailed('read', error);
      return undefined;
    }
  }

  async getAccessToken(): Promise<string> {
    const cached = await this.cached();
    if (cached && cached.expiresAt - this.skewMs > this.now()) {
      this.apiDomain = cached.apiDomain ?? this.apiDomain;
      return cached.accessToken;
    }
    return (await this.refresh()).accessToken;
  }

  getApiDomain(): string | undefined {
    return this.apiDomain;
  }

  async invalidate(token: string): Promise<boolean> {
    const cached = await this.cached();
    if (!cached || cached.accessToken === token) {
      await Promise.resolve(this.store.delete(this.key)).catch((error: unknown) => this.cacheFailed('delete', error));
    }
    return true;
  }

  /** Refresh now. Concurrent calls share one request. */
  refresh(): Promise<StoredToken> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = undefined;
      });
    }
    return this.inflight;
  }

  private async doRefresh(): Promise<StoredToken> {
    const run = async (): Promise<StoredToken> => {
      // Another process may have refreshed while we waited for the lock.
      const cached = await this.cached();
      if (cached && cached.expiresAt - this.skewMs > this.now()) return cached;

      const started = Date.now();
      let res: TokenResponse;
      try {
        res = await this.mint();
      } catch (error) {
        this.log.error('auth', 'zoho.token.refresh_failed', error instanceof Error ? error.message : String(error), {
          oauthError: error instanceof ZohoOAuthError ? error.oauthError : undefined,
          status: error instanceof ZohoOAuthError ? error.status : undefined,
          durationMs: Date.now() - started,
        });
        throw error;
      }
      const token: StoredToken = {
        accessToken: res.access_token,
        expiresAt: this.now() + (res.expires_in ?? 3600) * 1000,
        apiDomain: res.api_domain,
        scope: res.scope,
      };
      await Promise.resolve(this.store.set(this.key, token)).catch((error: unknown) => this.cacheFailed('write', error));
      this.log.info('auth', 'zoho.token.refreshed', 'Refreshed the Zoho access token', {
        expiresAt: new Date(token.expiresAt).toISOString(),
        apiDomain: token.apiDomain,
        durationMs: Date.now() - started,
      });
      this.onTokenRefreshed?.(token);
      return token;
    };
    let ran = false;
    const tracked = () => {
      ran = true;
      return run();
    };
    let token: StoredToken;
    try {
      token = await (this.store.withLock ? this.store.withLock(this.key, tracked) : tracked());
    } catch (error) {
      // The lock itself failed, e.g. the cache is down. Refresh without it rather than stop.
      if (ran) throw error;
      this.cacheFailed('lock', error);
      token = await run();
    }
    this.apiDomain = token.apiDomain ?? this.apiDomain;
    return token;
  }
}

export interface RefreshTokenAuthOptions extends OAuthClientOptions, CachingOptions {
  refreshToken: string;
}

/** Long lived refresh token in, short lived access tokens out. */
export class RefreshTokenAuth extends CachingTokenAuth {
  readonly oauth: ZohoOAuth;
  private readonly refreshToken: string;

  constructor(options: RefreshTokenAuthOptions) {
    super(options, `${options.clientId}:${options.refreshToken}`);
    this.oauth = new ZohoOAuth(options);
    this.refreshToken = options.refreshToken;
  }

  protected mint(): Promise<TokenResponse> {
    return this.oauth.refresh(this.refreshToken);
  }
}

export interface ClientCredentialsAuthOptions extends OAuthClientOptions, CachingOptions {
  scopes: string[];
  /** ZohoBooks.<organization_id> */
  soid?: string;
}

/** Self Client client_credentials grant. Experimental for Books. */
export class ClientCredentialsAuth extends CachingTokenAuth {
  readonly oauth: ZohoOAuth;
  private readonly scopes: string[];
  private readonly soid: string | undefined;

  constructor(options: ClientCredentialsAuthOptions) {
    super(options, `${options.clientId}:cc:${options.soid ?? ''}:${options.scopes.join(',')}`);
    this.oauth = new ZohoOAuth(options);
    this.scopes = options.scopes;
    this.soid = options.soid;
  }

  protected mint(): Promise<TokenResponse> {
    return this.oauth.clientCredentials(this.scopes, this.soid);
  }
}
