import type { HttpClient } from '../http/http-client.js';
import type { CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { Address, Comment, EmailInput } from '../types/common.js';
import type { Contact, ContactInput, ContactListParams, ContactPerson, ContactPersonInput } from '../types/models.js';
import { BaseResource, CrudResource, type ZohoEnvelope } from './base.js';
import type { UpsertOptions } from './document.js';

export class ContactsResource extends CrudResource<Contact, ContactInput, ContactInput, ContactListParams> {
  /** Contact persons of a contact: `client.contacts.persons.list(contactId)`. */
  readonly persons: ContactPersonsResource;

  constructor(http: HttpClient) {
    super(http, { path: 'contacts', singular: 'contact', plural: 'contacts' });
    this.persons = new ContactPersonsResource(http);
  }

  /** List only customers. */
  listCustomers(params: ContactListParams = {}, opts?: CallOptions): Promise<ListResult<Contact>> {
    return this.list({ ...params, contact_type: 'customer' }, opts);
  }

  /** List only vendors. */
  listVendors(params: ContactListParams = {}, opts?: CallOptions): Promise<ListResult<Contact>> {
    return this.list({ ...params, contact_type: 'vendor' }, opts);
  }

  /** Find the first contact whose GSTIN matches (India). */
  async findByGstin(gstin: string, opts?: CallOptions): Promise<Contact | undefined> {
    const target = gstin.trim().toUpperCase();
    for await (const c of this.iterate({ search_text: target }, {}, opts)) {
      if (typeof c.gst_no === 'string' && c.gst_no.toUpperCase() === target) return c;
    }
    return undefined;
  }

  markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  enablePortal(id: string, contactPersons: Array<{ contact_person_id: string }>, opts?: CallOptions): Promise<string> {
    return this.action(id, ['portal', 'enable'], { body: { contact_persons: contactPersons } }, opts);
  }
  enablePaymentReminders(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'enable'], {}, opts);
  }
  disablePaymentReminders(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'disable'], {}, opts);
  }

  /** Email the customer an account statement. */
  emailStatement(
    id: string,
    input: EmailInput,
    period?: { start_date?: string; end_date?: string },
    opts?: CallOptions,
  ): Promise<string> {
    return this.action(id, ['statements', 'email'], { body: input, query: period }, opts);
  }

  async listAddresses(id: string, opts?: CallOptions): Promise<Array<Address & { address_id: string }>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'address'), {}, opts);
    return (res.addresses as Array<Address & { address_id: string }> | undefined) ?? [];
  }

  addAddress(id: string, address: Address, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'address'), { body: address }, opts);
  }

  updateAddress(id: string, addressId: string, address: Address, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('PUT', this.url(id, 'address', addressId), { body: address }, opts);
  }

  async deleteAddress(id: string, addressId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'address', addressId), {}, opts);
  }

  async listComments(id: string, opts?: CallOptions): Promise<Comment[]> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'comments'), {}, opts);
    return (res.contact_comments as Comment[] | undefined) ?? (res.comments as Comment[] | undefined) ?? [];
  }

  /** Upsert by a unique custom field (see `DocumentResource.upsertByCustomField`). */
  upsertByCustomField(apiName: string, value: string, data: ContactInput, options: UpsertOptions = {}, opts?: CallOptions): Promise<Contact> {
    const headers: Record<string, string> = {
      'X-Unique-Identifier-Key': apiName,
      'X-Unique-Identifier-Value': value,
      ...(options.upsert ? { 'X-Upsert': 'true' } : {}),
      ...opts?.headers,
    };
    return this.one<Contact>('PUT', this.url(), { body: data }, { ...opts, headers });
  }
}

export class ContactPersonsResource extends BaseResource {
  constructor(http: HttpClient) {
    super(http, { path: 'contacts', singular: 'contact_person', plural: 'contact_persons' });
  }

  list(contactId: string, opts?: CallOptions): Promise<ListResult<ContactPerson>> {
    return this.listPage<ContactPerson>(this.url(contactId, 'contactpersons'), 'contact_persons', undefined, opts);
  }

  get(contactId: string, personId: string, opts?: CallOptions): Promise<ContactPerson> {
    return this.one<ContactPerson>('GET', this.url(contactId, 'contactpersons', personId), {}, opts);
  }

  create(contactId: string, data: ContactPersonInput, opts?: CallOptions): Promise<ContactPerson> {
    return this.one<ContactPerson>('POST', '/contacts/contactpersons', { body: { ...data, contact_id: contactId } }, opts);
  }

  update(personId: string, data: ContactPersonInput & { contact_id: string }, opts?: CallOptions): Promise<ContactPerson> {
    return this.one<ContactPerson>('PUT', `/contacts/contactpersons/${encodeURIComponent(personId)}`, { body: data }, opts);
  }

  async delete(personId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', `/contacts/contactpersons/${encodeURIComponent(personId)}`, {}, opts);
  }

  async markPrimary(personId: string, opts?: CallOptions): Promise<string> {
    const res = await this.call('POST', `/contacts/contactpersons/${encodeURIComponent(personId)}/primary`, {}, opts);
    return res.message;
  }
}
