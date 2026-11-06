import type { StoredToken, TokenStore } from './token-store.js';

/** Minimal key value cache, e.g. a Redis client wrapped in four functions. */
export interface KeyValueCache {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<unknown>;
  /** Set only if absent, like Redis SET NX EX. Resolves true when this caller set it. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  delete(key: string): Promise<unknown>;
}

export interface CacheTokenStoreOptions {
  /** Lock lifetime in seconds. Default 30. */
  lockTtlSeconds?: number;
  /** Wait between checks while another process refreshes. Default 300 ms. */
  pollIntervalMs?: number;
  /** Checks before refreshing anyway because the holder failed. Default 10. */
  pollAttempts?: number;
  /** @internal test hook */
  sleep?: (ms: number) => Promise<void>;
}

/** Token store over a shared cache with a refresh lock, so a fleet mints one token at a time. */
export function cacheTokenStore(cache: KeyValueCache, options: CacheTokenStoreOptions = {}): TokenStore {
  const lockTtl = options.lockTtlSeconds ?? 30;
  const pollMs = options.pollIntervalMs ?? 300;
  const attempts = options.pollAttempts ?? 10;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  return {
    async get(key) {
      const raw = await cache.get(key);
      return raw ? (JSON.parse(raw) as StoredToken) : undefined;
    },
    async set(key, token) {
      const ttl = Math.max(1, Math.floor((token.expiresAt - Date.now()) / 1000));
      await cache.set(key, JSON.stringify(token), ttl);
    },
    async delete(key) {
      await cache.delete(key);
    },
    async withLock(key, fn) {
      const lockKey = `${key}:lock`;
      if (await cache.setIfAbsent(lockKey, '1', lockTtl)) {
        try {
          return await fn();
        } finally {
          await cache.delete(lockKey).catch(() => undefined);
        }
      }
      // Another process is refreshing. Wait for it, then fn reads its token from the cache or refreshes itself.
      for (let i = 0; i < attempts; i++) {
        await sleep(pollMs);
        if (!(await cache.get(lockKey).catch(() => null))) break;
      }
      return fn();
    },
  };
}
