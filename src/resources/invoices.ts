import type { HttpClient } from '../http/http-client.js';
import type { CallOptions, Query } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { Comment, EmailInput } from '../types/common.js';
import type { CustomerPayment, Invoice, InvoiceInput, InvoiceListParams } from '../types/models.js';
import type { ZohoEnvelope } from './base.js';
import { DocumentResource, chunk, type BulkResult } from './document.js';
import { EInvoiceApi } from './einvoice.js';

export interface CreateInvoiceOptions {
  /** Email the invoice to the customer's contact persons right away. */
  send?: boolean;
  /** Use the `invoice_number` you supply instead of auto-numbering. */
  ignoreAutoNumberGeneration?: boolean;
  /** Extra query parameters. */
  query?: Query;
}

export interface ApplyCreditsInput {
  invoice_payments?: Array<{ payment_id: string; amount_applied: number }>;
  apply_creditnotes?: Array<{ creditnote_id: string; amount_applied: number }>;
}

export class InvoicesResource extends DocumentResource<Invoice, InvoiceInput, InvoiceInput, InvoiceListParams> {
  /** India IRP / UAE e-invoicing for invoices. */
  readonly einvoice: EInvoiceApi;

  constructor(http: HttpClient) {
    super(http, { path: 'invoices', singular: 'invoice', plural: 'invoices' });
    this.einvoice = new EInvoiceApi(http, 'invoices', 'invoice_ids');
  }

  /**
   * Create an invoice. Prefer this over the generic `create` to get typed
   * flags for `send` and custom numbering.
   */
  override create(data: InvoiceInput, query?: Query | CreateInvoiceOptions, opts?: CallOptions): Promise<Invoice> {
    return super.create(data, normalizeCreateQuery(query), opts);
  }

  /** Look up an invoice by its `reference_number`-style external reference id. */
  getByReference(referenceId: string, opts?: CallOptions): Promise<Invoice> {
    return this.one<Invoice>('GET', this.url('reference', referenceId), {}, opts);
  }

  // ── status ──
  markSent(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'sent'], {}, opts);
  }
  markVoid(id: string, reason?: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'void'], reason ? { body: { reason } } : {}, opts);
  }
  markDraft(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['status', 'draft'], {}, opts);
  }
  writeOff(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['writeoff'], {}, opts);
  }
  cancelWriteOff(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['writeoff', 'cancel'], {}, opts);
  }
  reject(id: string, reason?: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['reject'], reason ? { body: { reason } } : {}, opts);
  }

  /** Bulk: mark up to many invoices as sent (chunked by 25). */
  async markSentMany(ids: string[], opts?: CallOptions): Promise<BulkResult[]> {
    return this.bulk('status/sent', ids, 25, opts);
  }
  async markVoidMany(ids: string[], opts?: CallOptions): Promise<BulkResult[]> {
    return this.bulk('status/void', ids, 25, opts);
  }

  // ── email & reminders ──

  /** Email several invoices (Zoho allows 10 per call; chunked automatically). */
  async emailMany(ids: string[], body?: { contacts?: Array<{ contact_id: string; email?: boolean; snail_mail?: boolean }> }, opts?: CallOptions): Promise<BulkResult[]> {
    const out: BulkResult[] = [];
    for (const group of chunk(ids, 10)) {
      out.push(await this.call<BulkResult>('POST', this.url('email'), { query: { invoice_ids: group.join(',') }, body: body ?? {} }, opts));
    }
    return out;
  }

  sendPaymentReminder(id: string, input?: Partial<EmailInput>, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder'], input ? { body: input } : {}, opts);
  }

  /** Remind several customers (10 invoices per call; chunked automatically). */
  async sendPaymentReminders(ids: string[], opts?: CallOptions): Promise<BulkResult[]> {
    return this.bulk('paymentreminder', ids, 10, opts);
  }

  enablePaymentReminder(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'enable'], {}, opts);
  }
  disablePaymentReminder(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'disable'], {}, opts);
  }

  // ── payments & credits ──

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

  /** Apply existing customer payments / credit notes to this invoice. */
  applyCredits(id: string, input: ApplyCreditsInput, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'credits'), { body: input }, opts);
  }

  async deleteAppliedCredit(id: string, creditnotesInvoiceId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'creditsapplied', creditnotesInvoiceId), {}, opts);
  }

  /** Generate a shareable payment link for the invoice. */
  async paymentLink(id: string, options: { expiryTime?: string; linkType?: 'public' | 'private' } = {}, opts?: CallOptions): Promise<string | undefined> {
    const res = await this.call<Record<string, unknown>>(
      'GET',
      '/share/paymentlink',
      {
        query: {
          transaction_id: id,
          transaction_type: 'invoice',
          link_type: options.linkType ?? 'public',
          expiry_time: options.expiryTime,
        },
      },
      opts,
    );
    const data = res.data as { share_link?: string } | undefined;
    return data?.share_link;
  }

  // ── templates ──

  async listTemplates(opts?: CallOptions): Promise<Array<Record<string, unknown>>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url('templates'), {}, opts);
    return (res.templates as Array<Record<string, unknown>> | undefined) ?? [];
  }

  updateTemplate(id: string, templateId: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['templates', templateId], {}, opts, 'PUT');
  }

  // ── conversions ──

  /** Create an invoice from a confirmed sales order. */
  fromSalesOrder(salesorderId: string, opts?: CallOptions): Promise<Invoice> {
    return this.one<Invoice>('POST', this.url('fromsalesorder'), { query: { salesorder_id: salesorderId } }, opts);
  }

  /** Comments & history, typed for invoices. */
  override listComments(id: string, opts?: CallOptions): Promise<Comment[]> {
    return super.listComments(id, opts);
  }

  /** Unpaid invoices for a customer (convenience over `list`). */
  listUnpaid(customerId: string, params: InvoiceListParams = {}, opts?: CallOptions): Promise<ListResult<Invoice>> {
    return this.list({ ...params, customer_id: customerId, status: 'unpaid' }, opts);
  }

  private async bulk(segment: string, ids: string[], size: number, opts?: CallOptions): Promise<BulkResult[]> {
    const out: BulkResult[] = [];
    for (const group of chunk(ids, size)) {
      out.push(
        await this.call<BulkResult>('POST', `/invoices/${segment}`, { query: { invoice_ids: group.join(',') } }, opts),
      );
    }
    return out;
  }
}

export function normalizeCreateQuery(query: Query | CreateInvoiceOptions | undefined): Query | undefined {
  if (!query) return undefined;
  if ('send' in query || 'ignoreAutoNumberGeneration' in query || ('query' in query && typeof query.query === 'object')) {
    const o = query as CreateInvoiceOptions;
    return {
      ...(o.query ?? {}),
      ...(o.send !== undefined ? { send: o.send } : {}),
      ...(o.ignoreAutoNumberGeneration !== undefined ? { ignore_auto_number_generation: o.ignoreAutoNumberGeneration } : {}),
    };
  }
  return query as Query;
}
