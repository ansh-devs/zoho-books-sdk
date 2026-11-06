import type { HttpClient } from '../http/http-client.js';
import type { CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { Address, Comment, EmailInput } from '../types/common.js';
import type { Contact, ContactInput, ContactListParams, ContactPerson, ContactPersonInput } from '../types/models.js';
import { BaseResource, CrudResource, segment, type ZohoEnvelope } from './base.js';
import type { UpsertOptions } from './document.js';

export class ContactsResource extends CrudResource<Contact, ContactInput, ContactInput, ContactListParams> {
  /** Contact persons of a contact. */
  readonly persons: ContactPersonsResource;

  constructor(http: HttpClient) {
    super(http, { path: 'contacts', singular: 'contact', plural: 'contacts' });
    this.persons = new ContactPersonsResource(http);
  }

  async listCustomers(params: ContactListParams = {}, opts?: CallOptions): Promise<ListResult<Contact>> {
    return this.list({ ...params, contact_type: 'customer' }, opts);
  }

  async listVendors(params: ContactListParams = {}, opts?: CallOptions): Promise<ListResult<Contact>> {
    return this.list({ ...params, contact_type: 'vendor' }, opts);
  }

  /** Contact whose email equals this one, ignoring case. Zoho's filter also returns partial matches. */
  async findByEmail(email: string, opts?: CallOptions): Promise<Contact | undefined> {
    const target = email.trim().toLowerCase();
    for await (const c of this.iterate({ email: target }, { ...opts, limit: 200 })) {
      if (typeof c.email === 'string' && c.email.toLowerCase() === target) return c;
    }
    return undefined;
  }

  /** First contact with this GSTIN. */
  async findByGstin(gstin: string, opts?: CallOptions): Promise<Contact | undefined> {
    const target = gstin.trim().toUpperCase();
    for await (const c of this.iterate({ search_text: target }, opts)) {
      if (typeof c.gst_no === 'string' && c.gst_no.toUpperCase() === target) return c;
    }
    return undefined;
  }

  async markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  async markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  async enablePortal(id: string, contactPersons: Array<{ contact_person_id: string }>, opts?: CallOptions): Promise<string> {
    return this.action(id, ['portal', 'enable'], { body: { contact_persons: contactPersons } }, opts);
  }
  async enablePaymentReminders(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'enable'], {}, opts);
  }
  async disablePaymentReminders(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['paymentreminder', 'disable'], {}, opts);
  }

  /** Email an account statement, optionally for a period. */
  async emailStatement(id: string, input: EmailInput, period?: { start_date?: string; end_date?: string }, opts?: CallOptions): Promise<string> {
    return this.action(id, ['statements', 'email'], { body: input, query: period }, opts);
  }

  async listAddresses(id: string, opts?: CallOptions): Promise<Array<Address & { address_id: string }>> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'address'), {}, opts);
    return (res.addresses as Array<Address & { address_id: string }> | undefined) ?? [];
  }

  async addAddress(id: string, address: Address, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('POST', this.url(id, 'address'), { body: address }, opts);
  }

  async updateAddress(id: string, addressId: string, address: Address, opts?: CallOptions): Promise<ZohoEnvelope> {
    return this.call('PUT', this.url(id, 'address', addressId), { body: address }, opts);
  }

  async deleteAddress(id: string, addressId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id, 'address', addressId), {}, opts);
  }

  async listComments(id: string, opts?: CallOptions): Promise<Comment[]> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(id, 'comments'), {}, opts);
    return (res.contact_comments as Comment[] | undefined) ?? (res.comments as Comment[] | undefined) ?? [];
  }

  /** Update by a unique custom field instead of the id. */
  async upsertByCustomField(apiName: string, value: string, data: ContactInput, opts?: UpsertOptions): Promise<Contact> {
    return this.upsert<Contact>(apiName, value, data, opts);
  }
}

export class ContactPersonsResource extends BaseResource {
  constructor(http: HttpClient) {
    super(http, { path: 'contacts', singular: 'contact_person', plural: 'contact_persons' });
  }

  async list(contactId: string, opts?: CallOptions): Promise<ListResult<ContactPerson>> {
    return this.listPage<ContactPerson>(this.url(contactId, 'contactpersons'), 'contact_persons', undefined, opts);
  }

  async get(contactId: string, personId: string, opts?: CallOptions): Promise<ContactPerson> {
    return this.one<ContactPerson>('GET', this.url(contactId, 'contactpersons', personId), {}, opts);
  }

  async create(contactId: string, data: ContactPersonInput, opts?: CallOptions): Promise<ContactPerson> {
    segment(contactId);
    return this.one<ContactPerson>('POST', this.url('contactpersons'), { body: { ...data, contact_id: contactId } }, opts);
  }

  async update(personId: string, data: ContactPersonInput & { contact_id: string }, opts?: CallOptions): Promise<ContactPerson> {
    return this.one<ContactPerson>('PUT', this.url('contactpersons', personId), { body: data }, opts);
  }

  async delete(personId: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url('contactpersons', personId), {}, opts);
  }

  async markPrimary(personId: string, opts?: CallOptions): Promise<string> {
    const res = await this.call('POST', this.url('contactpersons', personId, 'primary'), {}, opts);
    return res.message;
  }
}
