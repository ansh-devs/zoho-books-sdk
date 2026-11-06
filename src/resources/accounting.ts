import type { HttpClient } from '../http/http-client.js';
import type { CallOptions, Query } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { BankAccount, BankTransaction, ChartOfAccount, Journal, JournalInput } from '../types/models.js';
import { CrudResource, type ZohoEnvelope } from './base.js';

export class ChartOfAccountsResource extends CrudResource<ChartOfAccount> {
  constructor(http: HttpClient) {
    super(http, { path: 'chartofaccounts', singular: 'chart_of_account', plural: 'chartofaccounts', aliases: ['account'], flat: true });
  }
  async markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  async markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  /** Transactions posted to an account. */
  async listTransactions(params: Query & { account_id: string }, opts?: CallOptions): Promise<ListResult<Record<string, unknown>>> {
    return this.listPage(this.url('accounttransactions'), 'transactions', params, opts);
  }
}

export class JournalsResource extends CrudResource<Journal, JournalInput, JournalInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'journals', singular: 'journal', plural: 'journals' });
  }
  async publish(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'publish'], {}, opts);
  }
  async submit(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['submit'], {}, opts);
  }
  async approve(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['approve'], {}, opts);
  }
}

export class BankAccountsResource extends CrudResource<BankAccount> {
  constructor(http: HttpClient) {
    super(http, { path: 'bankaccounts', singular: 'bankaccount', plural: 'bankaccounts' });
  }
  async markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  async markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  /** Last imported statement. */
  async lastStatement(id: string, opts?: CallOptions): Promise<Record<string, unknown>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'statement', 'lastimported'), {}, opts);
    return (res.statement as Record<string, unknown> | undefined) ?? res;
  }
}

/** Target of a categorization. Omit it for a plain transfer or deposit. */
export type CategorizeAs =
  | 'expenses'
  | 'customerpayments'
  | 'vendorpayments'
  | 'creditnoterefunds'
  | 'vendorcreditrefunds'
  | 'paymentrefunds'
  | 'vendorpaymentrefunds';

export class BankTransactionsResource extends CrudResource<BankTransaction> {
  constructor(http: HttpClient) {
    super(http, { path: 'banktransactions', singular: 'banktransaction', plural: 'banktransactions' });
  }

  /** Suggested matches for an uncategorized statement line. */
  async getMatches(transactionId: string, opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url('uncategorized', transactionId, 'match'), {}, opts);
    return (res.matching_transactions as Array<Record<string, unknown>> | undefined) ?? [];
  }

  async match(transactionId: string, transactions: Array<{ transaction_id: string; transaction_type: string }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url('uncategorized', transactionId, 'match'), { body: { transactions_to_be_matched: transactions } }, opts);
  }

  async unmatch(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(transactionId, 'unmatch'), {}, opts);
  }

  async exclude(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url('uncategorized', transactionId, 'exclude'), {}, opts);
  }

  async restore(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url('uncategorized', transactionId, 'restore'), {}, opts);
  }

  /** Categorize an uncategorized statement line. */
  async categorize(transactionId: string, data: Record<string, unknown>, opts: CallOptions & { as?: CategorizeAs } = {}): Promise<ZohoEnvelope> {
    const { as, ...callOpts } = opts;
    const segs = as ? ['uncategorized', transactionId, 'categorize', as] : ['uncategorized', transactionId, 'categorize'];
    return this.call('POST', this.url(...segs), { body: data }, callOpts);
  }

  async uncategorize(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(transactionId, 'uncategorize'), {}, opts);
  }
}
