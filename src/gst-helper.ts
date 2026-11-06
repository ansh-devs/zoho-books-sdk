import { ZohoGstError } from './errors.js';
import { findState, stateFromGstin, toPlaceOfSupply } from './gst/states.js';
import { GstTaxResolver, determineSupplyType, type GstTaxMap, type SupplyType, type TaxLike } from './gst/tax.js';
import { parseGstin, validateHsnOrSac } from './gst/validation.js';
import type { CallOptions } from './http/types.js';
import type { ContactsResource } from './resources/contacts.js';
import type { CreateOptions, InvoicesResource } from './resources/invoices.js';
import type { CreateCreditNoteOptions, CreditNotesResource } from './resources/sales.js';
import type { OrganizationsResource, TaxesResource } from './resources/settings.js';
import type { GstTreatment, LineItemInput, SalesDocumentInput } from './types/common.js';
import type { Contact, CreditNote, CreditNoteInput, Invoice, InvoiceInput, Organization } from './types/models.js';

export interface GstHelperOptions {
  /** Supplier state as code, GST code or name. Read from the organization when omitted. */
  homeState?: string;
  /** Explicit rate to tax id mapping. Wins over auto detection. */
  taxMap?: GstTaxMap;
  /** Check hsn_or_sac on every line. An object also enforces a minimum length. */
  validateHsn?: boolean | { minDigits: 4 | 6 | 8 };
  /** Require hsn_or_sac on every line, as e invoices do. */
  requireHsn?: boolean;
}

/** A line item that may carry a GST rate instead of a Zoho tax_id. */
export interface GstLineItem extends LineItemInput {
  /** GST rate in percent. Resolved to a tax_id. */
  gstRate?: number;
}

export type GstDocumentInput<T> = Omit<T, 'line_items'> & {
  customer_id: string;
  line_items: GstLineItem[];
};

export interface PreparedGstDocument<T> {
  payload: T;
  supplyType: SupplyType;
  placeOfSupply: string | undefined;
  gstTreatment: GstTreatment | undefined;
}

export interface PrepareOptions extends CallOptions {
  /** Use this contact instead of fetching it. */
  contact?: Contact;
}

/** Treatments that require the customer's GSTIN. */
const NEEDS_GSTIN: ReadonlySet<string> = new Set([
  'business_gst',
  'business_sez',
  'deemed_export',
  'business_registered_composition',
  'tax_deductor',
  'tax_collector',
]);

interface Deps {
  organizations: OrganizationsResource;
  taxes: TaxesResource;
  contacts: ContactsResource;
  invoices: InvoicesResource;
  creditNotes: CreditNotesResource;
  organizationId: () => string | undefined;
}

interface Context {
  homeState: string;
  resolver: GstTaxResolver;
}

/** GST invoicing: derives place of supply, checks the GSTIN and fills each line's tax_id from its gstRate. */
export class GstInvoiceHelper {
  private ctx: Promise<Context> | undefined;

  constructor(
    private readonly deps: Deps,
    private readonly options: GstHelperOptions = {},
  ) {}

  /** Drop the cached organization state and taxes. */
  refresh(): void {
    this.ctx = undefined;
  }

  /** Supplier state and tax resolver, fetched once and cached. */
  context(opts?: CallOptions): Promise<Context> {
    if (!this.ctx) {
      this.ctx = this.loadContext(opts).catch((e: unknown) => {
        this.ctx = undefined;
        throw e;
      });
    }
    return this.ctx;
  }

  /** Build a GST correct invoice payload without sending it. */
  prepareInvoice(input: GstDocumentInput<InvoiceInput>, opts?: PrepareOptions): Promise<PreparedGstDocument<InvoiceInput>> {
    return this.prepare<InvoiceInput>(input, opts);
  }

  /** Prepare and create the invoice. */
  async createInvoice(input: GstDocumentInput<InvoiceInput>, opts: PrepareOptions & CreateOptions = {}): Promise<Invoice> {
    const { contact, ...createOpts } = opts;
    const { payload } = await this.prepare<InvoiceInput>(input, { ...createOpts, ...(contact ? { contact } : {}) });
    return this.deps.invoices.create(payload, createOpts);
  }

  prepareCreditNote(input: GstDocumentInput<CreditNoteInput>, opts?: PrepareOptions): Promise<PreparedGstDocument<CreditNoteInput>> {
    return this.prepare<CreditNoteInput>(input, opts);
  }

  async createCreditNote(input: GstDocumentInput<CreditNoteInput>, opts: PrepareOptions & CreateCreditNoteOptions = {}): Promise<CreditNote> {
    const { contact, ...createOpts } = opts;
    const { payload } = await this.prepare<CreditNoteInput>(input, { ...createOpts, ...(contact ? { contact } : {}) });
    return this.deps.creditNotes.create(payload, createOpts);
  }

  private async prepare<T extends InvoiceInput | CreditNoteInput>(
    input: GstDocumentInput<T>,
    opts: PrepareOptions = {},
  ): Promise<PreparedGstDocument<T>> {
    const { contact: providedContact, query: _query, ...callOpts } = opts;
    const header = input as unknown as SalesDocumentInput;
    const [ctx, contact] = await Promise.all([
      this.context(callOpts),
      providedContact ? Promise.resolve(providedContact) : this.deps.contacts.get(input.customer_id, callOpts),
    ]);
    const { homeState } = ctx;
    let { resolver } = ctx;

    const gstTreatment = header.gst_treatment ?? contact.gst_treatment;
    const rawGstin = header.gst_no ?? contact.gst_no;

    let gstNo: string | undefined;
    if (rawGstin) {
      const info = parseGstin(rawGstin);
      if (!info.valid) throw new ZohoGstError(`Invalid GSTIN "${rawGstin}": ${info.reason}`, 'gst_no');
      gstNo = info.gstin;
    } else if (gstTreatment && NEEDS_GSTIN.has(gstTreatment)) {
      throw new ZohoGstError(`GST treatment "${gstTreatment}" requires the customer's GSTIN (gst_no)`, 'gst_no');
    }

    const posSource = header.place_of_supply ?? contact.place_of_contact ?? (gstNo ? stateFromGstin(gstNo)?.code : undefined);
    const placeOfSupply = gstTreatment === 'overseas' && !posSource ? undefined : toPlaceOfSupply(posSource ?? homeState);
    if (posSource && !placeOfSupply) {
      throw new ZohoGstError(`Unknown place of supply "${posSource}"`, 'place_of_supply');
    }

    const supplyType = determineSupplyType({ homeState, placeOfSupply, gstTreatment });

    // A rate the cache lacks may be a tax added in Zoho since, so reload once.
    const rates = input.line_items.filter((l) => l.gstRate !== undefined && l.tax_id === undefined).map((l) => l.gstRate!);
    if (rates.some((r) => !resolver.tryResolve(r, supplyType))) {
      this.refresh();
      resolver = (await this.context(callOpts)).resolver;
    }

    const lineItems: LineItemInput[] = input.line_items.map((line, i) => {
      const { gstRate, ...rest } = line;
      if (this.options.requireHsn && !rest.hsn_or_sac) {
        throw new ZohoGstError(`line_items[${i}]: hsn_or_sac is required`, `line_items[${i}].hsn_or_sac`);
      }
      if (rest.hsn_or_sac !== undefined && this.options.validateHsn) {
        const v = validateHsnOrSac(rest.hsn_or_sac, typeof this.options.validateHsn === 'object' ? this.options.validateHsn : {});
        if (!v.valid) throw new ZohoGstError(`line_items[${i}]: ${v.reason}`, `line_items[${i}].hsn_or_sac`);
        rest.hsn_or_sac = v.code;
      }
      if (gstRate !== undefined && rest.tax_id === undefined) {
        try {
          rest.tax_id = resolver.resolve(gstRate, supplyType);
        } catch (e) {
          throw new ZohoGstError(`line_items[${i}]: ${(e as Error).message}`, `line_items[${i}].tax_id`);
        }
      }
      return rest;
    });

    const payload = {
      ...input,
      line_items: lineItems,
      ...(gstTreatment ? { gst_treatment: gstTreatment } : {}),
      ...(gstNo ? { gst_no: gstNo } : {}),
      ...(placeOfSupply ? { place_of_supply: placeOfSupply } : {}),
    } as unknown as T;

    return { payload, supplyType, placeOfSupply, gstTreatment };
  }

  private async loadContext(opts?: CallOptions): Promise<Context> {
    const [homeState, taxes] = await Promise.all([this.resolveHomeState(opts), this.deps.taxes.listAll(undefined, opts)]);
    return { homeState, resolver: new GstTaxResolver(taxes as unknown as TaxLike[], this.options.taxMap) };
  }

  private async resolveHomeState(opts?: CallOptions): Promise<string> {
    if (this.options.homeState) {
      const s = findState(this.options.homeState);
      if (!s) throw new ZohoGstError(`Unknown homeState "${this.options.homeState}"`, 'homeState');
      return s.code;
    }
    const orgId = opts?.organizationId ?? this.deps.organizationId();
    if (!orgId) throw new ZohoGstError('Set organizationId, or pass gst.homeState, to resolve the supplier state', 'homeState');
    const org = await this.deps.organizations.get(orgId, opts);
    const state = homeStateFromOrganization(org);
    if (!state) {
      throw new ZohoGstError('Could not read the organization state for GST. Pass gst: { homeState: "KA" } in the client options', 'homeState');
    }
    return state;
  }
}

/** Supplier state from an organization's address or GSTIN, if present. */
export function homeStateFromOrganization(org: Organization): string | undefined {
  const address = (org.address ?? {}) as Record<string, unknown>;
  for (const c of [address.state_code, address.state, org.state_code, org.state]) {
    if (typeof c === 'string') {
      const s = findState(c);
      if (s) return s.code;
    }
  }
  for (const k of ['gst_no', 'gstin', 'tax_reg_no']) {
    const v = org[k];
    if (typeof v === 'string') {
      const s = stateFromGstin(v);
      if (s) return s.code;
    }
  }
  return undefined;
}
