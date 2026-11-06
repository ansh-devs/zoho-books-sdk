import type { HttpClient } from '../http/http-client.js';
import type { CallOptions, Query } from '../http/types.js';
import type { EInvoiceCancelInput, EInvoiceDetails, MarkEInvoicePushedInput } from '../types/models.js';
import { segment, type ZohoEnvelope } from './base.js';
import type { BulkResult } from './document.js';

export { canCancelIrn, IRN_CANCEL_WINDOW_MS } from '../gst/irn.js';

/** India IRP and UAE e invoicing for invoices or credit notes. */
export class EInvoiceApi {
  constructor(
    private readonly http: HttpClient,
    private readonly module: 'invoices' | 'creditnotes',
    /** invoice_ids or creditnote_ids for bulk calls. */
    private readonly idsKey: string,
  ) {}

  private req<T = ZohoEnvelope>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    init: { query?: Query; body?: unknown } = {},
    opts?: CallOptions,
  ): Promise<T> {
    return this.http.request<T>({
      method,
      path,
      query: init.query || opts?.query ? { ...init.query, ...opts?.query } : undefined,
      body: init.body,
      organizationId: opts?.organizationId,
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      headers: opts?.headers,
    });
  }

  private path(id: string, ...rest: string[]): string {
    return `/${this.module}/${segment(id)}/einvoice${rest.map((r) => `/${r}`).join('')}`;
  }

  /** Push to the IRP and generate the IRN. */
  async push(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', this.path(id, 'push'), {}, opts);
  }

  /** Push several documents. Check errors for failures per document. */
  async pushMany(ids: string[], opts?: CallOptions): Promise<BulkResult> {
    return this.req<BulkResult>('POST', `/${this.module}/einvoice/push`, { query: { [this.idsKey]: ids.join(',') } }, opts);
  }

  /** Cancel the IRN on the IRP. Allowed within 24 hours of acknowledgement. */
  async cancel(id: string, input: EInvoiceCancelInput = {}, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', this.path(id, 'cancel'), { body: input }, opts);
  }

  async cancelMany(ids: string[], input: EInvoiceCancelInput = {}, opts?: CallOptions): Promise<BulkResult> {
    return this.req<BulkResult>('POST', `/${this.module}/einvoice/cancel`, { query: { [this.idsKey]: ids.join(',') }, body: input }, opts);
  }

  /** IRN, acknowledgement and signed QR of a document. */
  async get(id: string, opts?: CallOptions): Promise<EInvoiceDetails> {
    const res = await this.req<Record<string, unknown>>('GET', this.path(id), {}, opts);
    const { code: _c, message: _m, ...rest } = res;
    return ((res.einvoice ?? res.einvoice_details ?? res.data) as EInvoiceDetails | undefined) ?? (rest as EInvoiceDetails);
  }

  /** Refresh status from the IRP. */
  async fetch(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', this.path(id, 'fetch'), {}, opts);
  }

  async list(query?: Query, opts?: CallOptions): Promise<Record<string, unknown>> {
    return this.req<Record<string, unknown>>('GET', `/${this.module}/einvoice`, { query }, opts);
  }

  /** Record an IRN generated outside Zoho. */
  async markPushed(id: string, input: MarkEInvoicePushedInput, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', this.path(id, 'status', 'push'), { body: input }, opts);
  }

  /** Record a cancellation done on the GST portal, required after 24 hours. */
  async markCancelled(id: string, input: EInvoiceCancelInput = {}, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', this.path(id, 'status', 'cancel'), { body: input }, opts);
  }

  /** Undo a manual push or cancel marking. */
  async recall(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', this.path(id, 'status', 'recall'), {}, opts);
  }

  /** Delete the stored e invoice status, e.g. after a failed push. */
  async deleteStatus(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('DELETE', this.path(id, 'status'), {}, opts);
  }
}
