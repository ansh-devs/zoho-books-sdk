/**
 * Zoho runs isolated data centers. An organization lives in exactly one, and
 * both the OAuth server and the API host must belong to that DC.
 */

/**
 * Books data centers. `ae` and `sa` are GCC; `ca` uses `zohocloud.ca` for its
 * accounts server. `uk` is listed by Zoho Accounts `/oauth/serverinfo` but is
 * not (yet) listed as a Books DC — kept for forward compatibility.
 */
export type DataCenter = 'us' | 'eu' | 'in' | 'au' | 'jp' | 'ca' | 'cn' | 'sa' | 'ae' | 'uk';

export interface DataCenterEndpoints {
  /** OAuth server, e.g. `https://accounts.zoho.in`. */
  accountsUrl: string;
  /** API domain, e.g. `https://www.zohoapis.in`. */
  apiDomain: string;
}

export const DATA_CENTERS: Readonly<Record<DataCenter, DataCenterEndpoints>> = Object.freeze({
  us: { accountsUrl: 'https://accounts.zoho.com', apiDomain: 'https://www.zohoapis.com' },
  eu: { accountsUrl: 'https://accounts.zoho.eu', apiDomain: 'https://www.zohoapis.eu' },
  in: { accountsUrl: 'https://accounts.zoho.in', apiDomain: 'https://www.zohoapis.in' },
  au: { accountsUrl: 'https://accounts.zoho.com.au', apiDomain: 'https://www.zohoapis.com.au' },
  jp: { accountsUrl: 'https://accounts.zoho.jp', apiDomain: 'https://www.zohoapis.jp' },
  ca: { accountsUrl: 'https://accounts.zohocloud.ca', apiDomain: 'https://www.zohoapis.ca' },
  cn: { accountsUrl: 'https://accounts.zoho.com.cn', apiDomain: 'https://www.zohoapis.com.cn' },
  sa: { accountsUrl: 'https://accounts.zoho.sa', apiDomain: 'https://www.zohoapis.sa' },
  ae: { accountsUrl: 'https://accounts.zoho.ae', apiDomain: 'https://www.zohoapis.ae' },
  uk: { accountsUrl: 'https://accounts.zoho.uk', apiDomain: 'https://www.zohoapis.uk' },
});

/** Path of the Books v3 API under the API domain. */
export const BOOKS_API_PATH = '/books/v3';

export function resolveDataCenter(dc: DataCenter | undefined): DataCenterEndpoints {
  const ep = DATA_CENTERS[dc ?? 'us'];
  if (!ep) {
    // Never silently fall back to `.com`: a wrong DC yields confusing `invalid_code` errors.
    throw new TypeError(`Unknown Zoho data center "${String(dc)}". Expected one of: ${Object.keys(DATA_CENTERS).join(', ')}`);
  }
  return ep;
}

/**
 * Infer the data center from an accounts-server URL or an `api_domain`
 * (as returned by the token endpoint). Returns `undefined` when unknown.
 */
export function dataCenterFromUrl(url: string): DataCenter | undefined {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
  for (const [dc, ep] of Object.entries(DATA_CENTERS) as [DataCenter, DataCenterEndpoints][]) {
    if (new URL(ep.accountsUrl).host === host || new URL(ep.apiDomain).host === host) return dc;
  }
  return undefined;
}
