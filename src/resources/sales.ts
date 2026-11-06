import type { HttpClient } from '../http/http-client.js';
import type { CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { CommonListParams } from '../types/common.js';
import type {
  CreditNote,
  CreditNoteInput,
  CustomerPayment,
  CustomerPaymentInput,
  DeliveryChallan,
  DeliveryChallanInput,
  Estimate,
  EstimateInput,
  Invoice,
  InvoiceInput,
  RecurringInvoice,
  RecurringInvoiceInput,
  Refund,
  RetainerInvoice,
  RetainerInvoiceInput,
  SalesOrder,
  SalesOrderInput,
  SalesReceipt,
  SalesReceiptInput,
} from '../types/models.js';
import { CrudResource, type IterateCallOptions, type ZohoEnvelope } from './base.js';
import { DocumentResource, type WithOnly } from './document.js';
import { EInvoiceApi } from './einvoice.js';
import { withCreateFlags, type CreateOptions } from './invoices.js';

const ESTIMATE_METHODS = [
  'bulkPdf',
  'email',
  'getEmailContent',
  'submit',
  'approve',
  'updateBillingAddress',
  'updateShippingAddress',
  'listComments',
  'addComment',
  'deleteComment',
  'upsertByCustomField',
] as const;

export class EstimatesResource extends DocumentResource<Estimate, EstimateInput, EstimateInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'estimates', singular: 'estimate', plural: 'estimates' }, ESTIMATE_METHODS);
  }
  override async create(data: EstimateInput, opts?: CreateOptions): Promise<Estimate> {
    return super.create(data, withCreateFlags(opts));
  }
  async markSent(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'sent'], {}, opts);
  }
  async markAccepted(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'accepted'], {}, opts);
  }
  async markDeclined(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'declined'], {}, opts);
  }
}
export type EstimatesApi = WithOnly<EstimatesResource, (typeof ESTIMATE_METHODS)[number]>;

const SALES_ORDER_METHODS = [
  'bulkPdf',
  'email',
  'getEmailContent',
  'submit',
  'approve',
  'updateBillingAddress',
  'updateShippingAddress',
  'listComments',
  'addComment',
  'deleteComment',
  'addAttachment',
  'getAttachment',
  'deleteAttachment',
  'upsertByCustomField',
] as const;

export class SalesOrdersResource extends DocumentResource<SalesOrder, SalesOrderInput, SalesOrderInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'salesorders', singular: 'salesorder', plural: 'salesorders' }, SALES_ORDER_METHODS);
  }
  override async create(data: SalesOrderInput, opts?: CreateOptions): Promise<SalesOrder> {
    return super.create(data, withCreateFlags(opts));
  }
  async markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  async markVoid(id: string, reason?: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], reason ? { body: { reason } } : {}, opts);
  }
}
export type SalesOrdersApi = WithOnly<SalesOrdersResource, (typeof SALES_ORDER_METHODS)[number]>;

const CREDIT_NOTE_METHODS = [
  'email',
  'getEmailContent',
  'submit',
  'approve',
  'updateBillingAddress',
  'updateShippingAddress',
  'listComments',
  'addComment',
  'deleteComment',
  'addAttachment',
  'upsertByCustomField',
] as const;

export interface CreateCreditNoteOptions extends CreateOptions {
  /** Raise the credit note against this invoice. */
  invoiceId?: string;
}

export class CreditNotesResource extends DocumentResource<CreditNote, CreditNoteInput, CreditNoteInput> {
  /** India IRP and UAE e invoicing. */
  readonly einvoice: EInvoiceApi;

  constructor(http: HttpClient) {
    super(http, { path: 'creditnotes', singular: 'creditnote', plural: 'creditnotes' }, CREDIT_NOTE_METHODS);
    this.einvoice = new EInvoiceApi(http, 'creditnotes', 'creditnote_ids');
  }

  override async create(data: CreditNoteInput, opts: CreateCreditNoteOptions = {}): Promise<CreditNote> {
    const { invoiceId, ...rest } = opts;
    const callOpts = withCreateFlags(rest);
    return super.create(data, invoiceId ? { ...callOpts, query: { ...callOpts.query, invoice_id: invoiceId } } : callOpts);
  }

  async markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  async markDraft(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'draft'], {}, opts);
  }
  async markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }

  /** Apply the credit to invoices. */
  async applyToInvoices(id: string, invoices: Array<{ invoice_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'invoices'), { body: { invoices } }, opts);
  }

  async listInvoicesCredited(id: string, opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'invoices'), {}, opts);
    return (res.invoices_credited as Array<Record<string, unknown>> | undefined) ?? [];
  }

  async deleteInvoiceCredited(id: string, creditnoteInvoiceId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'invoices', creditnoteInvoiceId), {}, opts);
  }

  /** Refund the remaining credit to the customer. */
  async refund(id: string, refund: Refund, opts?: CallOptions): Promise<Refund> {
    return this.one<Refund>('POST', this.url(id, 'refunds'), { body: refund }, opts, 'creditnote_refund');
  }

  async listRefunds(id: string, opts?: CallOptions): Promise<ListResult<Refund>> {
    return this.listPage<Refund>(this.url(id, 'refunds'), 'creditnote_refunds', undefined, opts);
  }

  async deleteRefund(id: string, refundId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'refunds', refundId), {}, opts);
  }
}
export type CreditNotesApi = WithOnly<CreditNotesResource, (typeof CREDIT_NOTE_METHODS)[number]>;

export class RecurringInvoicesResource extends CrudResource<RecurringInvoice, RecurringInvoiceInput, RecurringInvoiceInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'recurringinvoices', singular: 'recurring_invoice', plural: 'recurring_invoices' });
  }
  async stop(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'stop'], {}, opts);
  }
  async resume(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'resume'], {}, opts);
  }
  /** Invoices this profile generated. */
  async listChildInvoices(id: string, opts?: CallOptions): Promise<ListResult<Invoice>> {
    return this.listPage<Invoice>(this.url(id, 'invoices'), 'invoice_history', undefined, opts);
  }
  async enableAutoBill(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['autobill', 'enable'], {}, opts);
  }
  async disableAutoBill(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['autobill', 'disable'], {}, opts);
  }
}

const RETAINER_METHODS = [
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
] as const;

export class RetainerInvoicesResource extends DocumentResource<RetainerInvoice, RetainerInvoiceInput, RetainerInvoiceInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'retainerinvoices', singular: 'retainerinvoice', plural: 'retainerinvoices' }, RETAINER_METHODS);
  }
  async markSent(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'sent'], {}, opts);
  }
  async markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  async markDraft(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'draft'], {}, opts);
  }
  /** Apply retainer payments to invoices. */
  async applyToInvoices(id: string, invoices: Array<{ invoice_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'invoices'), { body: { invoices } }, opts);
  }
}
export type RetainerInvoicesApi = WithOnly<RetainerInvoicesResource, (typeof RETAINER_METHODS)[number]>;

export class SalesReceiptsResource extends CrudResource<SalesReceipt, SalesReceiptInput, SalesReceiptInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'salesreceipts', singular: 'salesreceipt', plural: 'salesreceipts', aliases: ['sales_receipt', 'sales_receipts'] });
  }
  async email(id: string, input: Record<string, unknown>, opts?: CallOptions): Promise<string> {
    const res = await this.call('POST', this.url(id, 'email'), { body: input }, opts);
    return res.message;
  }
}

/** Customer debit notes live on /invoices with type debit_note, which this adds. */
export class DebitNotesResource extends CrudResource<Invoice, InvoiceInput, InvoiceInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'invoices', singular: 'invoice', plural: 'debit_notes', aliases: ['invoices'] });
  }
  override async list(params?: CommonListParams, opts?: CallOptions): Promise<ListResult<Invoice>> {
    return super.list(params, { ...opts, query: { ...opts?.query, type: 'debit_note' } });
  }
  override iterate(params?: CommonListParams, opts?: IterateCallOptions): AsyncGenerator<Invoice, void, undefined> {
    return super.iterate(params, { ...opts, query: { ...opts?.query, type: 'debit_note' } });
  }
  override async create(data: InvoiceInput, opts?: CallOptions): Promise<Invoice> {
    return this.one<Invoice>('POST', this.url(), { body: { ...data, type: 'debit_note' } }, opts);
  }
}

const CHALLAN_METHODS = ['updateShippingAddress', 'addAttachment'] as const;

export class DeliveryChallansResource extends DocumentResource<DeliveryChallan, DeliveryChallanInput, DeliveryChallanInput> {
  constructor(http: HttpClient) {
    super(http, { path: 'deliverychallans', singular: 'deliverychallan', plural: 'deliverychallans' }, CHALLAN_METHODS);
  }
  async markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  async markDelivered(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'delivered'], {}, opts);
  }
  async markReturned(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'returned'], {}, opts);
  }
}
export type DeliveryChallansApi = WithOnly<DeliveryChallansResource, (typeof CHALLAN_METHODS)[number]>;

export class CustomerPaymentsResource extends CrudResource<CustomerPayment, CustomerPaymentInput, CustomerPaymentInput> {
  constructor(http: HttpClient) {
    super(http, {
      path: 'customerpayments',
      singular: 'payment',
      plural: 'customerpayments',
      aliases: ['customer_payments', 'customerpayment'],
    });
  }

  /** Refund the unused part of a payment. */
  async refund(id: string, refund: Refund, opts?: CallOptions): Promise<Refund> {
    return this.one<Refund>('POST', this.url(id, 'refunds'), { body: refund }, opts, 'payment_refund');
  }

  async listRefunds(id: string, opts?: CallOptions): Promise<ListResult<Refund>> {
    return this.listPage<Refund>(this.url(id, 'refunds'), 'payment_refunds', undefined, opts);
  }

  async deleteRefund(id: string, refundId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'refunds', refundId), {}, opts);
  }
}
