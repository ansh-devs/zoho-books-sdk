/** A cached access token. */
export interface StoredToken {
  accessToken: string;
  /** Expiry as epoch ms. */
  expiresAt: number;
  /** api_domain Zoho returned with the token. */
  apiDomain?: string | undefined;
  scope?: string | undefined;
}

/** Token cache. Share one store across processes so a fleet refreshes once. */
export interface TokenStore {
  get(key: string): Promise<StoredToken | undefined> | StoredToken | undefined;
  set(key: string, token: StoredToken): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  /** Optional cross process lock around a refresh, e.g. Redis SET NX PX. */
  withLock?<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/** Default store, local to one process. */
export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, StoredToken>();

  get(key: string): StoredToken | undefined {
    return this.tokens.get(key);
  }

  set(key: string, token: StoredToken): void {
    this.tokens.set(key, token);
  }

  delete(key: string): void {
    this.tokens.delete(key);
  }
}
