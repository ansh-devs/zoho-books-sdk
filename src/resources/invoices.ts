import type { HttpClient } from '../http/http-client.js';
import type { CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { EmailInput } from '../types/common.js';
import type { CustomerPayment, Invoice, InvoiceInput, InvoiceListParams } from '../types/models.js';
import type { ZohoEnvelope } from './base.js';
import { DocumentResource, chunk, type BulkResult } from './document.js';
import { EInvoiceApi } from './einvoice.js';

export interface CreateOptions extends CallOptions {
  /** Email the document to the customer's contact persons right away. */
  send?: boolean;
  /** Keep the number you set instead of auto numbering. */
  ignoreAutoNumberGeneration?: boolean;
}

/** Turn typed create flags into query parameters. */
export function withCreateFlags(opts: CreateOptions = {}): CallOptions {
  const { send, ignoreAutoNumberGeneration, ...callOpts } = opts;
  const flags = {
    ...(send !== undefined ? { send } : {}),
    ...(ignoreAutoNumberGeneration !== undefined ? { ignore_auto_number_generation: ignoreAutoNumberGeneration } : {}),
  };
  return Object.keys(flags).length ? { ...callOpts, query: { ...callOpts.query, ...flags } } : callOpts;
}

export interface ApplyCreditsInput {
  invoice_payments?: Array<{ payment_id: string; amount_applied: number }>;
  apply_creditnotes?: Array<{ creditnote_id: string; amount_applied: number }>;
}

export class InvoicesResource extends DocumentResource<Invoice, InvoiceInput, InvoiceInput, InvoiceListParams> {
  /** India IRP and UAE e invoicing. */
  readonly einvoice: EInvoiceApi;

  constructor(http: HttpClient) {
    super(http, { path: 'invoices', singular: 'invoice', plural: 'invoices' }, [
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
      'deleteMany',
    ]);
    this.einvoice = new EInvoiceApi(http, 'invoices', 'invoice_ids');
  }

  override async create(data: InvoiceInput, opts?: CreateOptions): Promise<Invoice> {
    return super.create(data, withCreateFlags(opts));
  }

  /** Invoice by its external reference id. */
  async getByReference(referenceId: string, opts?: CallOptions): Promise<Invoice> {
    return this.one<Invoice>('GET', this.url('reference', referenceId), {}, opts);
  }

  async markSent(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'sent'], {}, opts);
  }
  async markVoid(id: string, reason?: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], reason ? { body: { reason } } : {}, opts);
  }
  async markDraft(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'draft'], {}, opts);
  }
  async writeOff(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['writeoff'], {}, opts);
  }
  async cancelWriteOff(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['writeoff', 'cancel'], {}, opts);
  }
  async reject(id: string, reason?: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['reject'], reason ? { body: { reason } } : {}, opts);
  }

  /** Mark many as sent, 25 per call. */
  async markSentMany(ids: string[], opts?: CallOptions): Promise<BulkResult[]> {
    return this.bulk('status/sent', ids, 25, opts);
  }
  async markVoidMany(ids: string[], opts?: CallOptions): Promise<BulkResult[]> {
    return this.bulk('status/void', ids, 25, opts);
  }

  /** Email many invoices, 10 per call as Zoho allows. */
  async emailMany(
    ids: string[],
    body?: { contacts?: Array<{ contact_id: string; email?: boolean; snail_mail?: boolean }> },
    opts?: CallOptions,
  ): Promise<BulkResult[]> {
    const out: BulkResult[] = [];
    for (const group of chunk(ids, 10)) {
      out.push(await this.call<BulkResult>('POST', this.url('email'), { query: { invoice_ids: group.join(',') }, body: body ?? {} }, opts));
    }
    return out;
  }

  async sendPaymentReminder(id: string, input?: Partial<EmailInput>, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder'], input ? { body: input } : {}, opts);
  }

  /** Remind many customers, 10 invoices per call. */
  async sendPaymentReminders(ids: string[], opts?: CallOptions): Promise<BulkResult[]> {
    return this.bulk('paymentreminder', ids, 10, opts);
  }

  async enablePaymentReminder(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'enable'], {}, opts);
  }
  async disablePaymentReminder(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'disable'], {}, opts);
  }

  async listPayments(id: string, opts?: CallOptions): Promise<CustomerPayment[]> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'payments'), {}, opts);
    return (res.payments as CustomerPayment[] | undefined) ?? [];
  }

  async deletePayment(id: string, invoicePaymentId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'payments', invoicePaymentId), {}, opts);
  }

  async listCreditsApplied(id: string, opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'creditsapplied'), {}, opts);
    return (res.credits as Array<Record<string, unknown>> | undefined) ?? [];
  }

  /** Apply customer payments or credit notes to this invoice. */
  async applyCredits(id: string, input: ApplyCreditsInput, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'credits'), { body: input }, opts);
  }

  async deleteAppliedCredit(id: string, creditnotesInvoiceId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'creditsapplied', creditnotesInvoiceId), {}, opts);
  }

  /** Shareable payment link. */
  async paymentLink(id: string, options: CallOptions & { expiryTime?: string; linkType?: 'public' | 'private' } = {}): Promise<string | undefined> {
    const { expiryTime, linkType, ...opts } = options;
    const res = await this.call<Record<string, unknown>>(
      'GET',
      '/share/paymentlink',
      { query: { transaction_id: id, transaction_type: 'invoice', link_type: linkType ?? 'public', expiry_time: expiryTime } },
      opts,
    );
    return (res.data as { share_link?: string } | undefined)?.share_link;
  }

  async listTemplates(opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url('templates'), {}, opts);
    return (res.templates as Array<Record<string, unknown>> | undefined) ?? [];
  }

  async updateTemplate(id: string, templateId: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['templates', templateId], {}, opts, 'PUT');
  }

  /** Invoice from a confirmed sales order. */
  async fromSalesOrder(salesorderId: string, opts?: CallOptions): Promise<Invoice> {
    return this.one<Invoice>('POST', this.url('fromsalesorder'), { query: { salesorder_id: salesorderId } }, opts);
  }

  /** Unpaid invoices of one customer. */
  async listUnpaid(customerId: string, params: InvoiceListParams = {}, opts?: CallOptions): Promise<ListResult<Invoice>> {
    return this.list({ ...params, customer_id: customerId, status: 'unpaid' }, opts);
  }

  private async bulk(action: string, ids: string[], size: number, opts?: CallOptions): Promise<BulkResult[]> {
    const out: BulkResult[] = [];
    for (const group of chunk(ids, size)) {
      out.push(await this.call<BulkResult>('POST', `/invoices/${action}`, { query: { invoice_ids: group.join(',') } }, opts));
    }
    return out;
  }
}
