import type { HttpClient } from '../http/http-client.js';
import type { CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { CommonListParams } from '../types/common.js';
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
import { DocumentResource, toBlob, type UploadFile } from './document.js';

export class BillsResource extends DocumentResource<Bill, BillInput, BillInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'bills', singular: 'bill', plural: 'bills' });
  }
  markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  async listPayments(id: string, opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'payments'), {}, opts);
    return (res.payments as Array<Record<string, unknown>> | undefined) ?? [];
  }
  applyCredits(id: string, credits: Array<{ vendor_credit_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'credits'), { body: { bill_payments: [], apply_vendor_credits: credits } }, opts);
  }
}

export class PurchaseOrdersResource extends DocumentResource<PurchaseOrder, PurchaseOrderInput, PurchaseOrderInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'purchaseorders', singular: 'purchaseorder', plural: 'purchaseorders' });
  }
  markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  markBilled(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'billed'], {}, opts);
  }
  cancel(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'cancelled'], {}, opts);
  }
}

export class VendorCreditsResource extends DocumentResource<VendorCredit, VendorCreditInput, VendorCreditInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'vendorcredits', singular: 'vendor_credit', plural: 'vendorcredits', aliases: ['vendor_credits'] });
  }
  markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  applyToBills(id: string, bills: Array<{ bill_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'bills'), { body: { bills } }, opts);
  }
  refund(id: string, refund: Refund, opts?: CallOptions): Promise<Refund> {
    return this.one<Refund>('POST', this.url(id, 'refunds'), { body: refund }, opts, 'vendor_credit_refund');
  }
  listRefunds(id: string, opts?: CallOptions): Promise<ListResult<Refund>> {
    return this.listPage<Refund>(this.url(id, 'refunds'), 'vendor_credit_refunds', undefined, opts);
  }
}

export class VendorPaymentsResource extends CrudResource<VendorPayment, VendorPaymentInput, VendorPaymentInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'vendorpayments', singular: 'vendorpayment', plural: 'vendorpayments', aliases: ['vendor_payment', 'vendor_payments'] });
  }
}

export class ExpensesResource extends CrudResource<Expense, ExpenseInput, ExpenseInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'expenses', singular: 'expense', plural: 'expenses' });
  }

  /** Attach a receipt image/PDF (multipart field `receipt`). */
  addReceipt(id: string, file: UploadFile, filename: string, contentType?: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    const form = new FormData();
    form.append('receipt', toBlob(file, contentType), filename);
    return this.upload(this.url(id, 'receipt'), form, undefined, opts);
  }

  getReceipt(id: string, opts?: CallOptions) {
    return this.binary(this.url(id, 'receipt'), undefined, '*/*', opts);
  }

  async deleteReceipt(id: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'receipt'), {}, opts);
  }
}

export class RecurringExpensesResource extends CrudResource<RecurringExpense, Partial<RecurringExpense>, Partial<RecurringExpense>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'recurringexpenses', singular: 'recurring_expense', plural: 'recurring_expenses' });
  }
  stop(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'stop'], {}, opts);
  }
  resume(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'resume'], {}, opts);
  }
}

export class RecurringBillsResource extends CrudResource<RecurringBill, Partial<RecurringBill>, Partial<RecurringBill>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'recurringbills', singular: 'recurring_bill', plural: 'recurringbills', aliases: ['recurring_bills'] });
  }
  stop(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'stop'], {}, opts);
  }
  resume(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'resume'], {}, opts);
  }
}
