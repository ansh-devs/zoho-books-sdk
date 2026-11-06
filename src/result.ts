import {
  ZohoAuthenticationError,
  ZohoBooksError,
  ZohoConfigError,
  ZohoGstError,
  ZohoNetworkError,
  ZohoNoRecordError,
  ZohoOAuthError,
  ZohoRateLimitError,
  ZohoTimeoutError,
} from './errors.js';

/** Stable failure codes. ZOHO_<n> carries Zoho's own code, e.g. ZOHO_1002. */
export type ResultCode =
  | 'NETWORK'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INVALID_CREDENTIALS'
  | 'REFRESH_FAILED'
  | 'NOT_CONFIGURED'
  | 'GST_INVALID'
  | 'ZOHO_NO_ID'
  | `ZOHO_${number}`
  | 'HTTP_ERROR'
  | 'UNKNOWN';

export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: Error; code: ResultCode; data?: unknown };

/** Failure code for any error the SDK throws. */
export function resultCode(error: unknown): ResultCode {
  if (error instanceof ZohoRateLimitError) return 'RATE_LIMITED';
  if (error instanceof ZohoNetworkError || error instanceof ZohoTimeoutError) return 'NETWORK';
  if (error instanceof ZohoOAuthError) return error.oauthError === 'invalid_client' ? 'INVALID_CREDENTIALS' : 'REFRESH_FAILED';
  if (error instanceof ZohoAuthenticationError) return 'UNAUTHORIZED';
  if (error instanceof ZohoGstError) return 'GST_INVALID';
  if (error instanceof ZohoConfigError) return 'NOT_CONFIGURED';
  if (error instanceof ZohoNoRecordError) return 'ZOHO_NO_ID';
  if (error instanceof ZohoBooksError) return error.code !== undefined ? `ZOHO_${error.code}` : 'HTTP_ERROR';
  return 'UNKNOWN';
}

/** Await a call and return a result instead of throwing, for job runners that must never crash. */
export async function settle<T>(promise: Promise<T>): Promise<Result<T>> {
  try {
    return { success: true, data: await promise };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const data = e instanceof ZohoBooksError ? e.body : undefined;
    return { success: false, error, code: resultCode(e), ...(data !== undefined ? { data } : {}) };
  }
}
