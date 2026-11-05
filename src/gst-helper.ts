import { ZohoGstError } from './errors.js';
import { findState, stateFromGstin, toPlaceOfSupply } from './gst/states.js';
import { GstTaxResolver, determineSupplyType, type GstTaxMap, type SupplyType, type TaxLike } from './gst/tax.js';
import { parseGstin, validateHsnOrSac } from './gst/validation.js';
import type { CallOptions } from './http/types.js';
import type { ContactsResource } from './resources/contacts.js';
import type { InvoicesResource, CreateInvoiceOptions } from './resources/invoices.js';
import type { CreditNotesResource } from './resources/sales.js';
import type { OrganizationsResource, TaxesResource } from './resources/settings.js';
import type { GstTreatment, LineItemInput } from './types/common.js';
import type { Contact, CreditNote, CreditNoteInput, Invoice, InvoiceInput, Organization } from './types/models.js';

export interface GstHelperOptions {
  /**
   * Supplier state (code, GST code or name). Auto-detected from the
   * organization when omitted.
   */
  homeState?: string;
  /** Explicit rate → tax id mapping; overrides auto-detection. */
  taxMap?: GstTaxMap;
  /** Validate `hsn_or_sac` on every line. `true` = format only; object = min digits too. */
  validateHsn?: boolean | { minDigits: 4 | 6 | 8 };
  /** Require HSN/SAC on every line (mandatory on e-invoices). Default false. */
  requireHsn?: boolean;
}

/** A line item that may carry a GST rate instead of a Zoho `tax_id`. */
export interface GstLineItem extends LineItemInput {
  /** GST rate in percent (0, 0.25, 3, 5, 12, 18, 28, 40...). Resolved to a `tax_id`. */
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

/** Treatments that require a valid GSTIN on the customer. */
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

/**
 * High-level GST invoicing: give it a customer and line items with a
 * `gstRate`; it derives the place of supply, validates the GSTIN, decides
 * CGST+SGST vs IGST and fills in the right Zoho `tax_id` on every line.
 *
 * ```ts
 * const inv = await client.gst.createInvoice({
 *   customer_id,
 *   line_items: [{ item_id, quantity: 2, rate: 500, gstRate: 18, hsn_or_sac: '998314' }],
 * });
 * ```
 */
export class GstInvoiceHelper {
  private ctx: Promise<{ homeState: string; resolver: GstTaxResolver }> | undefined;

  constructor(
    private readonly deps: Deps,
    private readonly options: GstHelperOptions = {},
  ) {}

  /** Drop cached org/tax data (after you add taxes in Zoho, for example). */
  refresh(): void {
    this.ctx = undefined;
  }

  /** Supplier state code and tax resolver (fetched once, then cached). */
  context(opts?: CallOptions): Promise<{ homeState: string; resolver: GstTaxResolver }> {
    if (!this.ctx) {
      this.ctx = this.loadContext(opts).catch((e: unknown) => {
        this.ctx = undefined;
        throw e;
      });
    }
    return this.ctx;
  }

  /** Build (but don't send) a GST-correct invoice payload. */
  prepareInvoice(input: GstDocumentInput<InvoiceInput>, options: { contact?: Contact } & CallOptions = {}): Promise<PreparedGstDocument<InvoiceInput>> {
    return this.prepare<InvoiceInput>(input, options);
  }

  /** Prepare and create the invoice in one call. */
  async createInvoice(
    input: GstDocumentInput<InvoiceInput>,
    createOptions?: CreateInvoiceOptions,
    opts?: CallOptions & { contact?: Contact },
  ): Promise<Invoice> {
    const { payload } = await this.prepare<InvoiceInput>(input, opts ?? {});
    return this.deps.invoices.create(payload, createOptions, opts);
  }

  prepareCreditNote(input: GstDocumentInput<CreditNoteInput>, options: { contact?: Contact } & CallOptions = {}): Promise<PreparedGstDocument<CreditNoteInput>> {
    return this.prepare<CreditNoteInput>(input, options);
  }

  async createCreditNote(
    input: GstDocumentInput<CreditNoteInput>,
    createOptions?: CreateInvoiceOptions & { invoiceId?: string },
    opts?: CallOptions & { contact?: Contact },
  ): Promise<CreditNote> {
    const { payload } = await this.prepare<CreditNoteInput>(input, opts ?? {});
    return this.deps.creditNotes.create(payload, createOptions, opts);
  }

  private async prepare<T extends InvoiceInput | CreditNoteInput>(
    input: GstDocumentInput<T>,
    options: { contact?: Contact } & CallOptions,
  ): Promise<PreparedGstDocument<T>> {
    const { contact: providedContact, ...callOpts } = options;
    const [{ homeState, resolver }, contact] = await Promise.all([
      this.context(callOpts),
      providedContact ? Promise.resolve(providedContact) : this.deps.contacts.get(input.customer_id, undefined, callOpts),
    ]);

    const gstTreatment = (input.gst_treatment ?? contact.gst_treatment) as GstTreatment | undefined;
    const rawGstin = (input.gst_no ?? contact.gst_no) as string | undefined;

    let gstNo: string | undefined;
    if (rawGstin) {
      const info = parseGstin(rawGstin);
      if (!info.valid) throw new ZohoGstError(`Invalid GSTIN "${rawGstin}": ${info.reason}`, 'gst_no');
      gstNo = info.gstin;
    } else if (gstTreatment && NEEDS_GSTIN.has(gstTreatment)) {
      throw new ZohoGstError(`GST treatment "${gstTreatment}" requires the customer's GSTIN (gst_no)`, 'gst_no');
    }

    const posSource =
      (input.place_of_supply as string | undefined) ??
      (contact.place_of_contact as string | undefined) ??
      (gstNo ? stateFromGstin(gstNo)?.code : undefined);
    const placeOfSupply = gstTreatment === 'overseas' && !posSource ? undefined : toPlaceOfSupply(posSource ?? homeState);
    if (posSource && !placeOfSupply) {
      throw new ZohoGstError(`Unknown place of supply "${posSource}"`, 'place_of_supply');
    }

    const supplyType = determineSupplyType({ homeState, placeOfSupply, gstTreatment });

    const lineItems: LineItemInput[] = input.line_items.map((line, i) => {
      const { gstRate, ...rest } = line;
      if (this.options.requireHsn && !rest.hsn_or_sac) {
        throw new ZohoGstError(`line_items[${i}]: hsn_or_sac is required`, `line_items[${i}].hsn_or_sac`);
      }
      if (rest.hsn_or_sac !== undefined && this.options.validateHsn) {
        const v = validateHsnOrSac(
          rest.hsn_or_sac,
          typeof this.options.validateHsn === 'object' ? this.options.validateHsn : {},
        );
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

  private async loadContext(opts?: CallOptions): Promise<{ homeState: string; resolver: GstTaxResolver }> {
    const [homeState, taxes] = await Promise.all([this.resolveHomeState(opts), this.deps.taxes.listAll(undefined, {}, opts)]);
    return { homeState, resolver: new GstTaxResolver(taxes as unknown as TaxLike[], this.options.taxMap) };
  }

  private async resolveHomeState(opts?: CallOptions): Promise<string> {
    if (this.options.homeState) {
      const s = findState(this.options.homeState);
      if (!s) throw new ZohoGstError(`Unknown homeState "${this.options.homeState}"`, 'homeState');
      return s.code;
    }
    const orgId = opts?.organizationId ?? this.deps.organizationId();
    if (!orgId) throw new ZohoGstError('Set organizationId (or pass gst.homeState) to resolve the supplier state', 'homeState');
    const org = await this.deps.organizations.get(orgId, opts);
    const state = homeStateFromOrganization(org);
    if (!state) {
      throw new ZohoGstError(
        'Could not determine the organization state for GST; pass `gst: { homeState: "KA" }` in the client options',
        'homeState',
      );
    }
    return state;
  }
}

/** Best-effort supplier state from an organization record. */
export function homeStateFromOrganization(org: Organization): string | undefined {
  const address = (org.address ?? {}) as Record<string, unknown>;
  const candidates = [address.state_code, address.state, org.state_code, org.state];
  for (const c of candidates) {
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
