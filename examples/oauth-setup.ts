/**
 * One-time helper to mint a refresh token.
 *   1. node --experimental-strip-types examples/oauth-setup.ts            → prints consent URL
 *   2. node --experimental-strip-types examples/oauth-setup.ts <code>     → prints refresh token + orgs
 */
import { ZohoBooks, ZohoOAuth, Scopes, type DataCenter } from 'zoho-books-sdk';

const dataCenter = (process.env.ZOHO_DATA_CENTER ?? 'in') as DataCenter;
const redirectUri = process.env.ZOHO_REDIRECT_URI ?? 'http://localhost:3000/callback';
const oauth = new ZohoOAuth({ clientId: process.env.ZOHO_CLIENT_ID!, clientSecret: process.env.ZOHO_CLIENT_SECRET!, dataCenter });

const code = process.argv[2];
if (!code) {
  console.log(oauth.authorizationUrl({ scopes: Scopes.all(), redirectUri, prompt: 'consent' }));
} else {
  const tokens = await oauth.exchangeCode(code, redirectUri);
  console.log('refresh_token:', tokens.refresh_token);
  const books = new ZohoBooks({ accessToken: tokens.access_token, dataCenter });
  for (const org of await books.organizations.list()) console.log(org.organization_id, org.name, org.version);
}
