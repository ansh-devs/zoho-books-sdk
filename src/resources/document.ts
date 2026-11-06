import { ZohoConfigError } from '../errors.js';
import type { HttpClient } from '../http/http-client.js';
import type { BinaryResponse, CallOptions } from '../http/types.js';
import type { Address, Comment, CommonListParams, EmailInput } from '../types/common.js';
import { CrudResource, type ResourceConfig, type ZohoEnvelope } from './base.js';

export type UploadFile = Blob | Uint8Array | ArrayBuffer;

/** Bulk calls return HTTP 200 with failures per id in errors. */
export interface BulkResult extends ZohoEnvelope {
  errors?: Array<{ code: number; message: string; ids?: string[] }>;
}

export interface AttachmentOptions extends CallOptions {
  contentType?: string;
  canSendInEmail?: boolean;
}

export interface UpsertOptions extends CallOptions {
  /** Create the record when no match is found. */
  upsert?: boolean;
}

/** Document endpoints that only some modules have. Every module has pdf. */
export type DocMethod =
  | 'bulkPdf'
  | 'email'
  | 'getEmailContent'
  | 'submit'
  | 'approve'
  | 'updateBillingAddress'
  | 'updateShippingAddress'
  | 'listComments'
  | 'addComment'
  | 'deleteComment'
  | 'addAttachment'
  | 'getAttachment'
  | 'deleteAttachment'
  | 'upsertByCustomField'
  | 'deleteMany';

/** Resource type without the document methods its module lacks. */
export type WithOnly<R, M extends DocMethod> = Omit<R, Exclude<DocMethod, M>>;

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

/** Transactions such as invoices and bills. Each module lists the document endpoints Zoho gives it. */
export class DocumentResource<
  T,
  TCreate = Partial<T>,
  TUpdate = Partial<TCreate>,
  TListParams extends object = CommonListParams,
> extends CrudResource<T, TCreate, TUpdate, TListParams> {
  private readonly supported: ReadonlySet<DocMethod>;

  constructor(http: HttpClient, config: ResourceConfig, supported: readonly DocMethod[]) {
    super(http, config);
    this.supported = new Set(supported);
  }

  private need(method: DocMethod): void {
    if (!this.supported.has(method)) {
      throw new ZohoConfigError(`Zoho Books has no ${method} endpoint for ${this.config.path}`);
    }
  }

  /** Download as PDF. */
  async pdf(id: string, opts?: CallOptions): Promise<BinaryResponse> {
    return this.binary(this.url(id), { accept: 'pdf' }, 'application/pdf', opts);
  }

  /** Bulk PDF export. Zoho takes 25 ids per call, so larger lists are split. */
  async bulkPdf(ids: string[], opts?: CallOptions): Promise<BinaryResponse[]> {
    this.need('bulkPdf');
    const out: BinaryResponse[] = [];
    for (const group of chunk(ids, 25)) {
      out.push(await this.binary(this.url('pdf'), { [`${this.config.singular}_ids`]: group.join(',') }, 'application/pdf', opts));
    }
    return out;
  }

  async email(id: string, input: EmailInput, opts?: CallOptions): Promise<string> {
    this.need('email');
    const res = await this.call('POST', this.url(id, 'email'), { body: input }, opts);
    return res.message;
  }

  /** Subject, body and recipients Zoho would use by default. */
  async getEmailContent(id: string, opts?: CallOptions): Promise<Record<string, unknown>> {
    this.need('getEmailContent');
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'email'), {}, opts);
    return (res.data as Record<string, unknown> | undefined) ?? res;
  }

  async submit(id: string, opts?: CallOptions): Promise<string> {
    this.need('submit');
    return this.action(id, ['submit'], {}, opts);
  }

  async approve(id: string, opts?: CallOptions): Promise<string> {
    this.need('approve');
    return this.action(id, ['approve'], {}, opts);
  }

  async updateBillingAddress(id: string, address: Address, opts?: CallOptions): Promise<string> {
    this.need('updateBillingAddress');
    return this.action(id, ['address', 'billing'], { body: address }, opts, 'PUT');
  }

  async updateShippingAddress(id: string, address: Address, opts?: CallOptions): Promise<string> {
    this.need('updateShippingAddress');
    return this.action(id, ['address', 'shipping'], { body: address }, opts, 'PUT');
  }

  async listComments(id: string, opts?: CallOptions): Promise<Comment[]> {
    this.need('listComments');
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'comments'), {}, opts);
    return (res.comments as Comment[] | undefined) ?? [];
  }

  async addComment(id: string, description: string, opts?: CallOptions): Promise<Comment> {
    this.need('addComment');
    return this.one<Comment>('POST', this.url(id, 'comments'), { body: { description } }, opts, 'comment');
  }

  async deleteComment(id: string, commentId: string, opts?: CallOptions): Promise<void> {
    this.need('deleteComment');
    await this.call('DELETE', this.url(id, 'comments', commentId), {}, opts);
  }

  /** Attach a file, sent as the multipart field attachment. */
  async addAttachment(id: string, file: UploadFile, filename: string, opts: AttachmentOptions = {}): Promise<ZohoEnvelope> {
    this.need('addAttachment');
    const { contentType, canSendInEmail, ...callOpts } = opts;
    const form = new FormData();
    form.append('attachment', toBlob(file, contentType), filename);
    const query = canSendInEmail !== undefined ? { can_send_in_mail: canSendInEmail } : undefined;
    return this.upload(this.url(id, 'attachment'), form, query, callOpts);
  }

  /** Download the latest attachment. */
  async getAttachment(id: string, opts?: CallOptions): Promise<BinaryResponse> {
    this.need('getAttachment');
    return this.binary(this.url(id, 'attachment'), undefined, '*/*', opts);
  }

  async deleteAttachment(id: string, opts?: CallOptions): Promise<void> {
    this.need('deleteAttachment');
    await this.call('DELETE', this.url(id, 'attachment'), {}, opts);
  }

  /** Update by a unique custom field instead of the id. The only documented safe way to retry a write. */
  async upsertByCustomField(apiName: string, value: string, data: TCreate, opts?: UpsertOptions): Promise<T> {
    this.need('upsertByCustomField');
    return this.upsert<T>(apiName, value, data, opts);
  }

  async deleteMany(ids: string[], opts?: CallOptions): Promise<BulkResult> {
    this.need('deleteMany');
    return this.call<BulkResult>('DELETE', '/' + this.config.path, { query: { [`${this.config.singular}_ids`]: ids.join(',') } }, opts);
  }
}
