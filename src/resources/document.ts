import type { BinaryResponse, CallOptions, Query } from '../http/types.js';
import type { Address, Comment, EmailInput } from '../types/common.js';
import { CrudResource, type ListParams, type ZohoEnvelope } from './base.js';

export type UploadFile = Blob | Uint8Array | ArrayBuffer;

export interface UpsertOptions {
  /** Create the record when no match is found (sends `X-Upsert: true`). */
  upsert?: boolean;
}

/**
 * Bulk-result envelope: Zoho returns HTTP 200 with per-id failures in `errors`.
 * Exposed as-is so callers can act on partial success.
 */
export interface BulkResult extends ZohoEnvelope {
  errors?: Array<{ code: number; message: string; ids?: string[] }>;
}

export function toBlob(file: UploadFile, contentType?: string): Blob {
  if (file instanceof Blob) return file;
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  return new Blob([bytes as BlobPart], contentType ? { type: contentType } : undefined);
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Transactions (invoices, estimates, sales orders, credit notes, bills...)
 * share a set of sub-resources: PDF, email, comments, attachments,
 * approvals, address updates and custom-field upserts.
 */
export class DocumentResource<
  T,
  TCreate = Partial<T>,
  TUpdate = Partial<TCreate>,
  TListParams extends ListParams = ListParams,
> extends CrudResource<T, TCreate, TUpdate, TListParams> {
  /** Download the document as a PDF. */
  pdf(id: string, opts?: CallOptions): Promise<BinaryResponse> {
    return this.binary(this.url(id), { accept: 'pdf' }, 'application/pdf', opts);
  }

  /** Get the rendered HTML/print view. */
  print(id: string, opts?: CallOptions): Promise<BinaryResponse> {
    return this.binary(this.url(id), { print: true, accept: 'pdf' }, 'application/pdf', opts);
  }

  /** Bulk PDF export (Zoho allows 25 ids per call; larger lists are chunked). */
  async bulkPdf(ids: string[], opts?: CallOptions): Promise<BinaryResponse[]> {
    const idKey = `${this.config.singular}_ids`;
    const out: BinaryResponse[] = [];
    for (const group of chunk(ids, 25)) {
      out.push(await this.binary(this.url('pdf'), { [idKey]: group.join(',') }, 'application/pdf', opts));
    }
    return out;
  }

  /** Email the document. */
  async email(id: string, input: EmailInput, query?: Query, opts?: CallOptions): Promise<string> {
    const res = await this.call('POST', this.url(id, 'email'), { body: input, query }, opts);
    return res.message;
  }

  /** Get the default email subject/body/recipients Zoho would use. */
  async getEmailContent(id: string, query?: Query, opts?: CallOptions): Promise<Record<string, unknown>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'email'), { query }, opts);
    return (res.data as Record<string, unknown> | undefined) ?? res;
  }

  submit(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['submit'], {}, opts);
  }

  approve(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['approve'], {}, opts);
  }

  updateBillingAddress(id: string, address: Address, opts?: CallOptions): Promise<string> {
    return this.action(id, ['address', 'billing'], { body: address }, opts, 'PUT');
  }

  updateShippingAddress(id: string, address: Address, opts?: CallOptions): Promise<string> {
    return this.action(id, ['address', 'shipping'], { body: address }, opts, 'PUT');
  }

  // ── comments ──

  async listComments(id: string, opts?: CallOptions): Promise<Comment[]> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'comments'), {}, opts);
    return (res.comments as Comment[] | undefined) ?? [];
  }

  async addComment(id: string, description: string, extra?: Record<string, unknown>, opts?: CallOptions): Promise<Comment> {
    const res = await this.call<Record<string, unknown>>('POST', this.url(id, 'comments'), { body: { description, ...extra } }, opts);
    return (res.comment as Comment | undefined) ?? (res as unknown as Comment);
  }

  async deleteComment(id: string, commentId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'comments', commentId), {}, opts);
  }

  // ── attachments ──

  /** Attach a file (multipart field `attachment`). */
  async addAttachment(
    id: string,
    file: UploadFile,
    filename: string,
    options: { contentType?: string; canSendInEmail?: boolean } = {},
    opts?: CallOptions,
  ): Promise<ZohoEnvelope> {
    const form = new FormData();
    form.append('attachment', toBlob(file, options.contentType), filename);
    const query = options.canSendInEmail !== undefined ? { can_send_in_mail: options.canSendInEmail } : undefined;
    return this.upload(this.url(id, 'attachment'), form, query, opts);
  }

  /** Download the most recent attachment. */
  getAttachment(id: string, opts?: CallOptions): Promise<BinaryResponse> {
    return this.binary(this.url(id, 'attachment'), undefined, '*/*', opts);
  }

  async deleteAttachment(id: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'attachment'), {}, opts);
  }

  // ── upsert ──

  /**
   * Update (or create, with `upsert: true`) a record identified by a unique
   * custom field instead of its Zoho id — the only documented safe-retry
   * mechanism, ideal for syncing from an external system.
   */
  upsertByCustomField(
    apiName: string,
    value: string,
    data: TCreate,
    options: UpsertOptions = {},
    opts?: CallOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'X-Unique-Identifier-Key': apiName,
      'X-Unique-Identifier-Value': value,
      ...(options.upsert ? { 'X-Upsert': 'true' } : {}),
      ...opts?.headers,
    };
    return this.one<T>('PUT', this.url(), { body: data }, { ...opts, headers });
  }

  /** Bulk delete by ids. */
  async deleteMany(ids: string[], opts?: CallOptions): Promise<BulkResult> {
    const idKey = `${this.config.singular}_ids`;
    return this.call<BulkResult>('DELETE', this.url(), { query: { [idKey]: ids.join(',') } }, opts);
  }
}
