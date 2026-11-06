import type { HttpClient } from '../http/http-client.js';
import type { BinaryResponse, CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type {
  Bill,
  BillInput,
  Expense,
  ExpenseInput,
  PurchaseOrder,
  PurchaseOrderInput,
  RecurringBill,
  RecurringExpense,
  Refund,
  VendorCredit,
  VendorCreditInput,
  VendorPayment,
  VendorPaymentInput,
} from '../types/models.js';
import { CrudResource, type ZohoEnvelope } from './base.js';
import { DocumentResource, toBlob, type UploadFile, type WithOnly } from './document.js';

const BILL_METHODS = [
  'submit',
  'approve',
  'updateBillingAddress',
  'listComments',
  'addComment',
  'deleteComment',
  'addAttachment',
  'getAttachment',
  'deleteAttachment',
  'upsertByCustomField',
] as const;

export class BillsResource extends DocumentResource<Bill, BillInput, BillInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'bills', singular: 'bill', plural: 'bills' }, BILL_METHODS);
  }
  async markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  async markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  async listPayments(id: string, opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'payments'), {}, opts);
    return (res.payments as Array<Record<string, unknown>> | undefined) ?? [];
  }
  /** Apply vendor credits to this bill. */
  async applyCredits(id: string, credits: Array<{ vendor_credit_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'credits'), { body: { bill_payments: [], apply_vendor_credits: credits } }, opts);
  }
}
export type BillsApi = WithOnly<BillsResource, (typeof BILL_METHODS)[number]>;

const PURCHASE_ORDER_METHODS = [
  'email',
  'getEmailContent',
  'submit',
  'approve',
  'updateBillingAddress',
  'listComments',
  'addComment',
  'deleteComment',
  'addAttachment',
  'getAttachment',
  'deleteAttachment',
  'upsertByCustomField',
] as const;

export class PurchaseOrdersResource extends DocumentResource<PurchaseOrder, PurchaseOrderInput, PurchaseOrderInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'purchaseorders', singular: 'purchaseorder', plural: 'purchaseorders' }, PURCHASE_ORDER_METHODS);
  }
  async markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  async markBilled(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'billed'], {}, opts);
  }
  async cancel(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'cancelled'], {}, opts);
  }
}
export type PurchaseOrdersApi = WithOnly<PurchaseOrdersResource, (typeof PURCHASE_ORDER_METHODS)[number]>;

const VENDOR_CREDIT_METHODS = ['submit', 'approve', 'listComments', 'addComment', 'deleteComment'] as const;

export class VendorCreditsResource extends DocumentResource<VendorCredit, VendorCreditInput, VendorCreditInput> {
  constructor(http: HttpClient) {
    super(
      http,
      { path: 'vendorcredits', singular: 'vendor_credit', plural: 'vendorcredits', aliases: ['vendor_credits'] },
      VENDOR_CREDIT_METHODS,
    );
  }
  async markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  async markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  async applyToBills(id: string, bills: Array<{ bill_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'bills'), { body: { bills } }, opts);
  }
  async refund(id: string, refund: Refund, opts?: CallOptions): Promise<Refund> {
    return this.one<Refund>('POST', this.url(id, 'refunds'), { body: refund }, opts, 'vendor_credit_refund');
  }
  async listRefunds(id: string, opts?: CallOptions): Promise<ListResult<Refund>> {
    return this.listPage<Refund>(this.url(id, 'refunds'), 'vendor_credit_refunds', undefined, opts);
  }
}
export type VendorCreditsApi = WithOnly<VendorCreditsResource, (typeof VENDOR_CREDIT_METHODS)[number]>;

export class VendorPaymentsResource extends CrudResource<VendorPayment, VendorPaymentInput, VendorPaymentInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'vendorpayments', singular: 'vendorpayment', plural: 'vendorpayments', aliases: ['vendor_payment', 'vendor_payments'] });
  }
}

export class ExpensesResource extends CrudResource<Expense, ExpenseInput, ExpenseInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'expenses', singular: 'expense', plural: 'expenses' });
  }

  /** Attach a receipt, sent as the multipart field receipt. */
  async addReceipt(id: string, file: UploadFile, filename: string, opts: CallOptions & { contentType?: string } = {}): Promise<ZohoEnvelope> {
    const { contentType, ...callOpts } = opts;
    const form = new FormData();
    form.append('receipt', toBlob(file, contentType), filename);
    return this.upload(this.url(id, 'receipt'), form, undefined, callOpts);
  }

  async getReceipt(id: string, opts?: CallOptions): Promise<BinaryResponse> {
    return this.binary(this.url(id, 'receipt'), undefined, '*/*', opts);
  }

  async deleteReceipt(id: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'receipt'), {}, opts);
  }
}

export class RecurringExpensesResource extends CrudResource<RecurringExpense, ExpenseInput, ExpenseInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'recurringexpenses', singular: 'recurring_expense', plural: 'recurring_expenses' });
  }
  async stop(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'stop'], {}, opts);
  }
  async resume(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'resume'], {}, opts);
  }
}

export class RecurringBillsResource extends CrudResource<RecurringBill, BillInput, BillInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'recurringbills', singular: 'recurring_bill', plural: 'recurringbills', aliases: ['recurring_bills'] });
  }
  async stop(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'stop'], {}, opts);
  }
  async resume(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'resume'], {}, opts);
  }
}
