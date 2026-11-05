/**
 * Token persistence. Zoho caps how many access tokens a refresh token may mint
 * in a short window, so in multi-process deployments (k8s replicas, serverless)
 * every instance should share one store (Redis, a DB row, ...) instead of each
 * refreshing on its own.
 */

export interface StoredToken {
  accessToken: string;
  /** Epoch milliseconds at which the access token expires. */
  expiresAt: number;
  /** `api_domain` reported by Zoho for this token, if any. */
  apiDomain?: string | undefined;
  /** Scope string, if reported. */
  scope?: string | undefined;
}

export interface TokenStore {
  get(key: string): Promise<StoredToken | undefined> | StoredToken | undefined;
  set(key: string, token: StoredToken): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  /**
   * Optional cross-process lock around a refresh. Implement it (for example
   * with Redis `SET NX PX`) to guarantee a single refresh across a fleet. The
   * SDK always single-flights refreshes inside one process regardless.
   */
  withLock?<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

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
