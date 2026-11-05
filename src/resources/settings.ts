import type { HttpClient } from '../http/http-client.js';
import type { CallOptions } from '../http/types.js';
import type { ListResult } from '../pagination.js';
import type { CommonListParams } from '../types/common.js';
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

  /**
   * List organizations the token can access. Works without an organization id,
   * which makes it the natural first call after OAuth.
   */
  async list(opts?: CallOptions): Promise<Organization[]> {
    const res = await this.call<Record<string, unknown>>('GET', this.url(), {}, { ...opts, organizationId: '' });
    return (res.organizations as Organization[] | undefined) ?? [];
  }

  get(id: string, opts?: CallOptions): Promise<Organization> {
    return this.one<Organization>('GET', this.url(id), {}, opts);
  }

  update(id: string, data: Partial<Organization>, opts?: CallOptions): Promise<Organization> {
    return this.one<Organization>('PUT', this.url(id), { body: data }, opts);
  }
}

export class ItemsResource extends CrudResource<Item, ItemInput, ItemInput, ItemListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'items', singular: 'item', plural: 'items' });
  }
  markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  /** Fetch several items in one call (`/itemdetails?item_ids=`). */
  async getMany(ids: string[], opts?: CallOptions): Promise<Item[]> {
    const res = await this.call<Record<string, unknown>>('GET', '/itemdetails', { query: { item_ids: ids.join(',') } }, opts);
    return (res.items as Item[] | undefined) ?? [];
  }
}

export class TaxesResource extends CrudResource<Tax, TaxInput, TaxInput, CommonListParams> {
  /** Tax groups (e.g. GST 18% = CGST 9% + SGST 9%). */
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
  get(id: string, opts?: CallOptions): Promise<TaxGroup> {
    return this.one<TaxGroup>('GET', this.url(id), {}, opts);
  }
  create(data: TaxGroupInput, opts?: CallOptions): Promise<TaxGroup> {
    return this.one<TaxGroup>('POST', this.url(), { body: data }, opts);
  }
  update(id: string, data: TaxGroupInput, opts?: CallOptions): Promise<TaxGroup> {
    return this.one<TaxGroup>('PUT', this.url(id), { body: data }, opts);
  }
  async delete(id: string, opts?: CallOptions): Promise<void> {
    await this.call('DELETE', this.url(id), {}, opts);
  }
}

export class CurrenciesResource extends CrudResource<Currency, Partial<Currency>, Partial<Currency>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'settings/currencies', singular: 'currency', plural: 'currencies' });
  }
}

export class UsersResource extends CrudResource<User, Partial<User>, Partial<User>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'users', singular: 'user', plural: 'users' });
  }
  /** The user that owns the current token. */
  me(opts?: CallOptions): Promise<User> {
    return this.one<User>('GET', this.url('me'), {}, opts);
  }
  invite(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['invite'], {}, opts);
  }
  markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
}

export class LocationsResource extends CrudResource<Location, Partial<Location>, Partial<Location>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'locations', singular: 'location', plural: 'locations' });
  }
  markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
}

export class ProjectsResource extends CrudResource<Project, Partial<Project>, Partial<Project>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'projects', singular: 'project', plural: 'projects' });
  }
  markActive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['active'], {}, opts);
  }
  markInactive(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['inactive'], {}, opts);
  }
  clone(id: string, data: { project_name: string; description?: string }, opts?: CallOptions): Promise<Project> {
    return this.one<Project>('POST', this.url(id, 'clone'), { body: data }, opts);
  }
  listTasks(id: string, opts?: CallOptions): Promise<ListResult<ProjectTask>> {
    return this.listPage<ProjectTask>(this.url(id, 'tasks'), 'tasks', undefined, opts);
  }
  addTask(id: string, data: Partial<ProjectTask> & { task_name: string }, opts?: CallOptions): Promise<ProjectTask> {
    return this.one<ProjectTask>('POST', this.url(id, 'tasks'), { body: data }, opts, 'task');
  }
}

export class TimeEntriesResource extends CrudResource<TimeEntry, Partial<TimeEntry>, Partial<TimeEntry>, CommonListParams> {
  constructor(http: HttpClient) {
    super(http, { path: 'projects/timeentries', singular: 'time_entry', plural: 'time_entries' });
  }
  startTimer(id: string, opts?: CallOptions): Promise<string> {
    return this.action(id, ['timer', 'start'], {}, opts);
  }
  async stopTimer(opts?: CallOptions): Promise<string> {
    const res = await this.call('POST', this.url('timer', 'stop'), {}, opts);
    return res.message;
  }
}
