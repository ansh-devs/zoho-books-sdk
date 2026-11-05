import type { HttpClient } from '../http/http-client.js';
import type { CallOptions, Query } from '../http/types.js';
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
import { CrudResource, type ZohoEnvelope } from './base.js';
import { DocumentResource } from './document.js';
import { EInvoiceApi } from './einvoice.js';
import { normalizeCreateQuery, type CreateInvoiceOptions } from './invoices.js';

export class EstimatesResource extends DocumentResource<Estimate, EstimateInput, EstimateInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'estimates', singular: 'estimate', plural: 'estimates' });
  }
  override create(data: EstimateInput, query?: Query | CreateInvoiceOptions, opts?: CallOptions): Promise<Estimate> {
    return super.create(data, normalizeCreateQuery(query), opts);
  }
  markSent(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'sent'], {}, opts);
  }
  markAccepted(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'accepted'], {}, opts);
  }
  markDeclined(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'declined'], {}, opts);
  }
}

export class SalesOrdersResource extends DocumentResource<SalesOrder, SalesOrderInput, SalesOrderInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'salesorders', singular: 'salesorder', plural: 'salesorders' });
  }
  override create(data: SalesOrderInput, query?: Query | CreateInvoiceOptions, opts?: CallOptions): Promise<SalesOrder> {
    return super.create(data, normalizeCreateQuery(query), opts);
  }
  markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  markVoid(id: string, reason?: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], reason ? { body: { reason } } : {}, opts);
  }
}

export class CreditNotesResource extends DocumentResource<CreditNote, CreditNoteInput, CreditNoteInput, CommonListParams> {
  /** India IRP / UAE e-invoicing for credit notes. */
  readonly einvoice: EInvoiceApi;

  constructor(http: HttpClient) {
    super(http, { path: 'creditnotes', singular: 'creditnote', plural: 'creditnotes' });
    this.einvoice = new EInvoiceApi(http, 'creditnotes', 'creditnote_ids');
  }

  /** Create a credit note, optionally against an invoice (`invoiceId`). */
  override create(
    data: CreditNoteInput,
    query?: Query | (CreateInvoiceOptions & { invoiceId?: string }),
    opts?: CallOptions,
  ): Promise<CreditNote> {
    const q = normalizeCreateQuery(query) ?? {};
    if (query && 'invoiceId' in query && query.invoiceId) q.invoice_id = query.invoiceId as string;
    delete (q as Record<string, unknown>).invoiceId;
    return super.create(data, q, opts);
  }

  markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  markDraft(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'draft'], {}, opts);
  }
  markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }

  /** Apply the credit note to one or more invoices. */
  applyToInvoices(id: string, invoices: Array<{ invoice_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'invoices'), { body: { invoices } }, opts);
  }

  async listInvoicesCredited(id: string, opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'invoices'), {}, opts);
    return (res.invoices_credited as Array<Record<string, unknown>> | undefined) ?? [];
  }

  async deleteInvoiceCredited(id: string, creditnoteInvoiceId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'invoices', creditnoteInvoiceId), {}, opts);
  }

  /** Refund the credit note balance to the customer. */
  refund(id: string, refund: Refund, opts?: CallOptions): Promise<Refund> {
    return this.one<Refund>('POST', this.url(id, 'refunds'), { body: refund }, opts, 'creditnote_refund');
  }

  listRefunds(id: string, opts?: CallOptions): Promise<ListResult<Refund>> {
    return this.listPage<Refund>(this.url(id, 'refunds'), 'creditnote_refunds', undefined, opts);
  }

  async deleteRefund(id: string, refundId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'refunds', refundId), {}, opts);
  }
}

export class RecurringInvoicesResource extends CrudResource<RecurringInvoice, RecurringInvoiceInput, RecurringInvoiceInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'recurringinvoices', singular: 'recurring_invoice', plural: 'recurring_invoices' });
  }
  stop(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'stop'], {}, opts);
  }
  resume(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'resume'], {}, opts);
  }
  /** Invoices generated by this profile. */
  listChildInvoices(id: string, opts?: CallOptions): Promise<ListResult<Invoice>> {
    return this.listPage<Invoice>(this.url(id, 'invoices'), 'invoice_history', undefined, opts);
  }
  enableAutoBill(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['autobill', 'enable'], {}, opts);
  }
  disableAutoBill(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['autobill', 'disable'], {}, opts);
  }
}

export class RetainerInvoicesResource extends DocumentResource<RetainerInvoice, RetainerInvoiceInput, RetainerInvoiceInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'retainerinvoices', singular: 'retainerinvoice', plural: 'retainerinvoices' });
  }
  markSent(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'sent'], {}, opts);
  }
  markVoid(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], {}, opts);
  }
  markDraft(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'draft'], {}, opts);
  }
  /** Apply retainer payments to invoices. */
  applyToInvoices(id: string, invoices: Array<{ invoice_id: string; amount_applied: number }>, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'invoices'), { body: { invoices } }, opts);
  }
}

export class SalesReceiptsResource extends CrudResource<SalesReceipt, SalesReceiptInput, SalesReceiptInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'salesreceipts', singular: 'salesreceipt', plural: 'salesreceipts', aliases: ['sales_receipt', 'sales_receipts'] });
  }
  async email(id: string, input: Record<string, unknown>, opts?: CallOptions): Promise<string> {
    const res = await this.call('POST', this.url(id, 'email'), { body: input }, opts);
    return res.message;
  }
}

/**
 * Customer debit notes live on the `/invoices` endpoint with
 * `type=debit_note`; this resource adds that discriminator for you.
 */
export class DebitNotesResource extends CrudResource<Invoice, InvoiceInput, InvoiceInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'invoices', singular: 'invoice', plural: 'debit_notes', aliases: ['invoices'] });
  }
  override list(params?: CommonListParams, opts?: CallOptions): Promise<ListResult<Invoice>> {
    return super.list({ ...params, type: 'debit_note' }, opts);
  }
  override iterate(params?: CommonListParams, options?: Parameters<CrudResource<Invoice>['iterate']>[1], opts?: CallOptions) {
    return super.iterate({ ...params, type: 'debit_note' }, options, opts);
  }
  override create(data: InvoiceInput, query?: Query, opts?: CallOptions): Promise<Invoice> {
    return super.create({ ...data, type: 'debit_note' }, query, opts);
  }
}

export class DeliveryChallansResource extends DocumentResource<DeliveryChallan, DeliveryChallanInput, DeliveryChallanInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'deliverychallans', singular: 'deliverychallan', plural: 'deliverychallans' });
  }
  markOpen(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'open'], {}, opts);
  }
  markDelivered(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'delivered'], {}, opts);
  }
  markReturned(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'returned'], {}, opts);
  }
}

export class CustomerPaymentsResource extends CrudResource<CustomerPayment, CustomerPaymentInput, CustomerPaymentInput, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, {
      path: 'customerpayments',
      singular: 'payment',
      plural: 'customerpayments',
      aliases: ['customer_payments', 'customerpayment'],
    });
  }

  /** Refund an excess (unused) customer payment. */
  refund(id: string, refund: Refund, opts?: CallOptions): Promise<Refund> {
    return this.one<Refund>('POST', this.url(id, 'refunds'), { body: refund }, opts, 'payment_refund');
  }

  listRefunds(id: string, opts?: CallOptions): Promise<ListResult<Refund>> {
    return this.listPage<Refund>(this.url(id, 'refunds'), 'payment_refunds', undefined, opts);
  }

  async deleteRefund(id: string, refundId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'refunds', refundId), {}, opts);
  }
}
