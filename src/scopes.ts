/**
 * OAuth scope helpers. Format: `ZohoBooks.<module>.<CREATE|READ|UPDATE|DELETE|ALL>`.
 * Note: `settings` covers items, users, taxes, currencies and opening
 * balances; `debitnotes` is Vendor Credits.
 */
export const SCOPE_MODULES = [
  'contacts',
  'settings',
  'estimates',
  'invoices',
  'customerpayments',
  'creditnotes',
  'projects',
  'expenses',
  'salesorders',
  'purchaseorders',
  'bills',
  'debitnotes',
  'vendorpayments',
  'banking',
  'accountants',
] as const;

export type ScopeModule = (typeof SCOPE_MODULES)[number] | (string & {});
export type ScopeOperation = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'ALL';

export function scope(module: ScopeModule, operation: ScopeOperation = 'ALL'): string {
  return `ZohoBooks.${module}.${operation}`;
}

export const Scopes = {
  /** Full access to every documented module. */
  all(): string[] {
    return SCOPE_MODULES.map((m) => scope(m, 'ALL'));
  },
  /** Read-only access to every documented module. */
  readOnly(): string[] {
    return SCOPE_MODULES.map((m) => scope(m, 'READ'));
  },
  /** Typical invoicing integration: contacts, items/taxes, invoices, payments, credit notes. */
  invoicing(): string[] {
    return ['contacts', 'settings', 'invoices', 'customerpayments', 'creditnotes', 'estimates', 'salesorders'].map((m) =>
      scope(m, 'ALL'),
    );
  },
};
