import type { HttpClient } from '../http/http-client.js';
import type { CallOptions, Query } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { CommonListParams } from '../types/common.js';
import type { BankAccount, BankTransaction, ChartOfAccount, Journal, JournalInput } from '../types/models.js';
import { CrudResource, type ZohoEnvelope } from './base.js';

export class ChartOfAccountsResource extends CrudResource<ChartOfAccount, Partial<ChartOfAccount>, Partial<ChartOfAccount>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'chartofaccounts', singular: 'chart_of_account', plural: 'chartofaccounts', aliases: ['account'] });
  }
  markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  /** Transactions posted to an account. */
  listTransactions(params: Query & { account_id: string }, opts?: CallOptions): Promise<ListResult<Record<string, unknown>>> {
    return this.listPage(this.url('transactions'), 'transactions', params, opts);
  }
}

export class JournalsResource extends CrudResource<Journal, JournalInput, JournalInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'journals', singular: 'journal', plural: 'journals' });
  }
  publish(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'publish'], {}, opts);
  }
  submit(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['submit'], {}, opts);
  }
  approve(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['approve'], {}, opts);
  }
}

export class BankAccountsResource extends CrudResource<BankAccount, Partial<BankAccount>, Partial<BankAccount>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'bankaccounts', singular: 'bankaccount', plural: 'bankaccounts' });
  }
  markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  /** Last imported statement. */
  async lastStatement(id: string, opts?: CallOptions): Promise<Record<string, unknown>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'statement', 'lastimported'), {}, opts);
    return (res.statement as Record<string, unknown> | undefined) ?? res;
  }
}

export class BankTransactionsResource extends CrudResource<BankTransaction, Partial<BankTransaction>, Partial<BankTransaction>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'banktransactions', singular: 'banktransaction', plural: 'banktransactions' });
  }

  /** Suggested matches for an uncategorized statement line. */
  async getMatches(transactionId: string, query?: Query, opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url('uncategorized', transactionId, 'match'), { query }, opts);
    return (res.matching_transactions as Array<Record<string, unknown>> | undefined) ?? [];
  }

  match(transactionId: string, transactions: Array<{ transaction_id: string; transaction_type: string }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url('uncategorized', transactionId, 'match'), { body: { transactions_to_be_matched: transactions } }, opts);
  }

  unmatch(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(transactionId, 'unmatch'), {}, opts);
  }

  exclude(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url('uncategorized', transactionId, 'exclude'), {}, opts);
  }

  restore(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url('uncategorized', transactionId, 'restore'), {}, opts);
  }

  /**
   * Categorize an uncategorized line. `as` selects the target type, e.g.
   * `expenses`, `customerpayments`, `vendorpayments`; omit for a generic transfer/deposit.
   */
  categorize(
    transactionId: string,
    data: Record<string, unknown>,
    as?: 'expenses' | 'customerpayments' | 'vendorpayments' | 'creditnoterefunds' | 'vendorcreditrefunds' | 'paymentrefunds' | 'vendorpaymentrefunds',
    opts?: CallOptions,
  ): Promise<ZohoEnvelope> {
    const segs = as ? ['uncategorized', transactionId, 'categorize', as] : ['uncategorized', transactionId, 'categorize'];
    return this.call('POST', this.url(...segs), { body: data }, opts);
  }

  uncategorize(transactionId: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(transactionId, 'uncategorize'), {}, opts);
  }
}
