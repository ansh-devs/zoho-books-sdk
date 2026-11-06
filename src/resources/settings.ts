import { ZohoConfigError } from '../errors.js';
import type { HttpClient } from '../http/http-client.js';
import type { CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type {
  Currency,
  Item,
  ItemInput,
  ItemListParams,
  Location,
  Organization,
  Project,
  ProjectTask,
  Tax,
  TaxGroup,
  TaxGroupInput,
  TaxInput,
  TimeEntry,
  User,
} from '../types/models.js';
import { BaseResource, CrudResource } from './base.js';

export class OrganizationsResource extends BaseResource {
  constructor(http: HttpClient) {
    super(http, { path: 'organizations', singular: 'organization', plural: 'organizations' });
  }

  /** Organizations the token can access. Needs no organization id, so it is the first call after OAuth. */
  async list(opts?: CallOptions): Promise<Organization[]> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(), {}, { ...opts, organizationId: '' });
    return (res.organizations as Organization[] | undefined) ?? [];
  }

  async get(id: string, opts?: CallOptions): Promise<Organization> {
    return this.one<Organization>('GET', this.url(id), {}, opts);
  }

  async update(id: string, data: Partial<Organization>, opts?: CallOptions): Promise<Organization> {
    return this.one<Organization>('PUT', this.url(id), { body: data }, opts);
  }
}

export class ItemsResource extends CrudResource<Item, ItemInput, ItemInput, ItemListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'items', singular: 'item', plural: 'items' });
  }
  async markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  async markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  /** Several items in one call. */
  async getMany(ids: string[], opts?: CallOptions): Promise<Item[]> {
    const res = await this.call<Record<string, unknown>>('GET', '/itemdetails', { query: { item_ids: ids.join(',') } }, opts);
    return (res.items as Item[] | undefined) ?? [];
  }
}

export class TaxesResource extends CrudResource<Tax, TaxInput, TaxInput> {
  /** Tax groups, e.g. GST 18% made of CGST 9% and SGST 9%. */
  readonly groups: TaxGroupsResource;

  constructor(http: HttpClient) {
    super(http, { path: 'settings/taxes', singular: 'tax', plural: 'taxes' });
    this.groups = new TaxGroupsResource(http);
  }
}

export class TaxGroupsResource extends BaseResource {
  constructor(http: HttpClient) {
    super(http, { path: 'settings/taxgroups', singular: 'tax_group', plural: 'tax_groups' });
  }
  async get(id: string, opts?: CallOptions): Promise<TaxGroup> {
    return this.one<TaxGroup>('GET', this.url(id), {}, opts);
  }
  async create(data: TaxGroupInput, opts?: CallOptions): Promise<TaxGroup> {
    return this.one<TaxGroup>('POST', this.url(), { body: data }, opts);
  }
  async update(id: string, data: TaxGroupInput, opts?: CallOptions): Promise<TaxGroup> {
    return this.one<TaxGroup>('PUT', this.url(id), { body: data }, opts);
  }
  async delete(id: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id), {}, opts);
  }
}

export class CurrenciesResource extends CrudResource<Currency> {
  constructor(http: HttpClient) {
    super(http, { path: 'settings/currencies', singular: 'currency', plural: 'currencies' });
  }
}

export class UsersResource extends CrudResource<User> {
  constructor(http: HttpClient) {
    super(http, { path: 'users', singular: 'user', plural: 'users' });
  }
  /** Owner of the current token. */
  async me(opts?: CallOptions): Promise<User> {
    return this.one<User>('GET', this.url('me'), {}, opts);
  }
  async invite(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['invite'], {}, opts);
  }
  async markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  async markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
}

export class LocationsResource extends CrudResource<Location> {
  constructor(http: HttpClient) {
    super(http, { path: 'locations', singular: 'location', plural: 'locations' });
  }
  /** Zoho has no endpoint for one location. Use list. */
  override async get(): Promise<Location> {
    return Promise.reject(new ZohoConfigError('Zoho Books has no get endpoint for locations. Use list.'));
  }
  async markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  async markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
}
export type LocationsApi = Omit<LocationsResource, 'get'>;

export class ProjectsResource extends CrudResource<Project> {
  constructor(http: HttpClient) {
    super(http, { path: 'projects', singular: 'project', plural: 'projects' });
  }
  async markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  async markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  async clone(id: string, data: { project_name: string; description?: string }, opts?: CallOptions): Promise<Project> {
    return this.one<Project>('POST', this.url(id, 'clone'), { body: data }, opts);
  }
  async listTasks(id: string, opts?: CallOptions): Promise<ListResult<ProjectTask>> {
    return this.listPage<ProjectTask>(this.url(id, 'tasks'), 'tasks', undefined, opts);
  }
  async addTask(id: string, data: Partial<ProjectTask> & { task_name: string }, opts?: CallOptions): Promise<ProjectTask> {
    return this.one<ProjectTask>('POST', this.url(id, 'tasks'), { body: data }, opts, 'task');
  }
}

export class TimeEntriesResource extends CrudResource<TimeEntry> {
  constructor(http: HttpClient) {
    super(http, { path: 'projects/timeentries', singular: 'time_entry', plural: 'time_entries' });
  }
  async startTimer(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['timer', 'start'], {}, opts);
  }
  async stopTimer(opts?: CallOptions): Promise<string> {
    const res = await this.call('POST', this.url('timer', 'stop'), {}, opts);
    return res.message;
  }
}
