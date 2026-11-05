import type { HttpClient } from '../http/http-client.js';
import type { CallOptions, Query } from '../http/types.js';
import type { EInvoiceCancelInput, EInvoiceDetails, MarkEInvoicePushedInput } from '../types/models.js';
import type { ZohoEnvelope } from './base.js';
import type { BulkResult } from './document.js';

export { canCancelIrn, IRN_CANCEL_WINDOW_MS } from '../gst/irn.js';

/**
 * E-invoicing (India IRP / UAE) operations for invoices or credit notes:
 * `client.invoices.einvoice.push(id)`.
 */
export class EInvoiceApi {
  constructor(
    private readonly http: HttpClient,
    /** `invoices` or `creditnotes`. */
    private readonly module: 'invoices' | 'creditnotes',
    /** `invoice_ids` / `creditnote_ids` for bulk calls. */
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
      query: init.query,
      body: init.body,
      organizationId: opts?.organizationId,
      signal: opts?.signal,
      timeoutMs: opts?.timeoutMs,
      headers: opts?.headers,
    });
  }

  /** Push one document to the IRP and generate its IRN. */
  push(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', `/${this.module}/${encodeURIComponent(id)}/einvoice/push`, {}, opts);
  }

  /** Push several documents. Inspect `errors` for per-document failures. */
  pushMany(ids: string[], opts?: CallOptions): Promise<BulkResult> {
    return this.req<BulkResult>('POST', `/${this.module}/einvoice/push`, { query: { [this.idsKey]: ids.join(',') } }, opts);
  }

  /** Cancel the IRN on the IRP (only within 24 h of acknowledgement). */
  cancel(id: string, input: EInvoiceCancelInput = {}, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', `/${this.module}/${encodeURIComponent(id)}/einvoice/cancel`, { body: input }, opts);
  }

  cancelMany(ids: string[], input: EInvoiceCancelInput = {}, opts?: CallOptions): Promise<BulkResult> {
    return this.req<BulkResult>(
      'POST',
      `/${this.module}/einvoice/cancel`,
      { query: { [this.idsKey]: ids.join(',') }, body: input },
      opts,
    );
  }

  /** Get the generated e-invoice (IRN, ack no/date, signed QR...). */
  async get(id: string, opts?: CallOptions): Promise<EInvoiceDetails> {
    const res = await this.req<Record<string, unknown>>('GET', `/${this.module}/${encodeURIComponent(id)}/einvoice`, {}, opts);
    const { code: _c, message: _m, ...rest } = res;
    return ((res.einvoice ?? res.einvoice_details ?? res.data) as EInvoiceDetails | undefined) ?? (rest as EInvoiceDetails);
  }

  /** Re-sync status from the IRP. */
  fetch(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', `/${this.module}/${encodeURIComponent(id)}/einvoice/fetch`, {}, opts);
  }

  /** List e-invoice records (filters passed through). */
  list(query?: Query, opts?: CallOptions): Promise<Record<string, unknown>> {
    return this.req<Record<string, unknown>>('GET', `/${this.module}/einvoice`, { query }, opts);
  }

  /** Record an IRN generated outside Zoho (e.g. directly on the IRP portal). */
  markPushed(id: string, input: MarkEInvoicePushedInput, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', `/${this.module}/${encodeURIComponent(id)}/einvoice/status/push`, { body: input }, opts);
  }

  /** Record a cancellation done outside Zoho (required after the 24 h window). */
  markCancelled(id: string, input: EInvoiceCancelInput = {}, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', `/${this.module}/${encodeURIComponent(id)}/einvoice/status/cancel`, { body: input }, opts);
  }

  /** Undo a manual push/cancel marking. */
  recall(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('POST', `/${this.module}/${encodeURIComponent(id)}/einvoice/status/recall`, {}, opts);
  }

  /** Delete the locally stored e-invoice status (e.g. after a failed push). */
  deleteStatus(id: string, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.req('DELETE', `/${this.module}/${encodeURIComponent(id)}/einvoice/status`, {}, opts);
  }
}
