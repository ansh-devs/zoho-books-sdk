import type { GstTreatment } from '../types/common.js';
import { findState } from './states.js';

/** intra is CGST plus SGST or UTGST. inter is IGST. */
export type SupplyType = 'intra' | 'inter';

/** Exports and SEZ supplies are always inter state under IGST. */
const ALWAYS_INTER: ReadonlySet<string> = new Set(['overseas', 'business_sez', 'deemed_export']);

export interface SupplyTypeInput {
  /** Supplier state as code, GST code or name. */
  homeState: string;
  /** Place of supply as code, GST code or name. */
  placeOfSupply: string | undefined;
  gstTreatment?: GstTreatment | undefined;
}

/** Intra or inter state supply, by IGST Act sections 7 and 8. */
export function determineSupplyType(input: SupplyTypeInput): SupplyType {
  if (input.gstTreatment && ALWAYS_INTER.has(input.gstTreatment)) return 'inter';
  const home = findState(input.homeState);
  if (!home) throw new TypeError(`Unknown home state "${input.homeState}"`);
  if (!input.placeOfSupply) return 'intra';
  const pos = findState(input.placeOfSupply);
  if (!pos) throw new TypeError(`Unknown place of supply "${input.placeOfSupply}"`);
  return home.code === pos.code ? 'intra' : 'inter';
}

/** Round half away from zero. The relative epsilon fixes 1.005 without drifting large amounts. */
export function roundMoney(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  const r = Math.round(Math.abs(value) * f * (1 + Number.EPSILON));
  return (Math.sign(value) * r) / f;
}

export interface GstLineInput {
  quantity: number;
  rate: number;
  /** GST rate in percent, e.g. 18. */
  gstRate: number;
  /** Compensation cess rate in percent. */
  cessRate?: number;
  /** Flat amount, or a percentage string like "10%". */
  discount?: number | string;
}

export interface GstLineBreakdown {
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  totalTax: number;
  total: number;
}

export interface GstBreakdown extends GstLineBreakdown {
  lines: GstLineBreakdown[];
  /** Difference to the nearest rupee when roundToRupee is set. Use it as Zoho's adjustment. */
  roundOff: number;
  grandTotal: number;
}

export interface ComputeGstOptions {
  supplyType: SupplyType;
  /** Line rates already include tax. */
  inclusive?: boolean;
  /** Round the grand total to whole rupees. */
  roundToRupee?: boolean;
}

/** GST breakdown computed locally, rounded per line with CGST and SGST split evenly. */
export function computeGst(lines: GstLineInput[], options: ComputeGstOptions): GstBreakdown {
  const out: GstLineBreakdown[] = lines.map((l) => {
    const gross = l.quantity * l.rate;
    const discount =
      typeof l.discount === 'string' && l.discount.trim().endsWith('%')
        ? (gross * Number.parseFloat(l.discount)) / 100
        : Number(l.discount ?? 0);
    const amount = gross - discount;
    const rateTotal = l.gstRate + (l.cessRate ?? 0);
    const taxable = roundMoney(options.inclusive ? amount / (1 + rateTotal / 100) : amount);

    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (options.supplyType === 'intra') {
      cgst = roundMoney((taxable * l.gstRate) / 200);
      sgst = cgst;
    } else {
      igst = roundMoney((taxable * l.gstRate) / 100);
    }
    const cess = roundMoney((taxable * (l.cessRate ?? 0)) / 100);
    const totalTax = roundMoney(cgst + sgst + igst + cess);
    return { taxableValue: taxable, cgst, sgst, igst, cess, totalTax, total: roundMoney(taxable + totalTax) };
  });

  const sum = (k: keyof GstLineBreakdown) => roundMoney(out.reduce((a, l) => a + l[k], 0));
  const total = sum('total');
  const grandTotal = options.roundToRupee ? Math.round(total) : total;
  return {
    lines: out,
    taxableValue: sum('taxableValue'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    cess: sum('cess'),
    totalTax: sum('totalTax'),
    total,
    roundOff: roundMoney(grandTotal - total),
    grandTotal,
  };
}

/** Fields of a Zoho tax or tax group the resolver reads. */
export interface TaxLike {
  tax_id?: string;
  tax_group_id?: string;
  tax_name?: string;
  tax_group_name?: string;
  tax_percentage?: number;
  tax_group_percentage?: number;
  tax_type?: string;
  tax_specific_type?: string;
  status?: string;
  [key: string]: unknown;
}

/** Explicit rate to tax id mapping, e.g. { 18: { intra: groupId, inter: igstId } }. */
export type GstTaxMap = Record<number, Partial<Record<SupplyType, string>>>;

/** Picks the Zoho tax id for a rate: the CGST plus SGST group when intra, IGST when inter. taxMap wins. */
export class GstTaxResolver {
  private readonly taxes: TaxLike[];
  private readonly taxMap: GstTaxMap;

  constructor(taxes: TaxLike[], taxMap: GstTaxMap = {}) {
    this.taxes = taxes.filter((t) => t.status === undefined || t.status === 'active');
    this.taxMap = taxMap;
  }

  /** Tax id, or throws listing what the org has configured. */
  resolve(rate: number, supplyType: SupplyType): string {
    const id = this.tryResolve(rate, supplyType);
    if (id) return id;
    const available = this.taxes
      .map((t) => `${nameOf(t)} (${percentOf(t)}%${t.tax_specific_type ? `, ${t.tax_specific_type}` : ''}${isGroup(t) ? ', group' : ''})`)
      .join('; ');
    throw new TypeError(
      `No ${supplyType === 'inter' ? 'IGST' : 'CGST+SGST group'} tax found for ${rate}%. ` +
        `Configure it in Zoho Books or pass taxMap. Available: ${available || 'none'}`,
    );
  }

  tryResolve(rate: number, supplyType: SupplyType): string | undefined {
    const mapped = this.taxMap[rate]?.[supplyType];
    if (mapped) return mapped;
    const candidates = this.taxes.filter((t) => Math.abs(percentOf(t) - rate) < 1e-6);

    if (supplyType === 'inter') {
      const igst =
        candidates.find((t) => t.tax_specific_type === 'igst') ??
        candidates.find((t) => !isGroup(t) && /igst/i.test(nameOf(t)));
      return idOf(igst);
    }
    if (rate === 0) {
      const nil = candidates.find((t) => t.tax_specific_type === 'nil' || /nil|exempt|zero/i.test(nameOf(t)));
      if (nil) return idOf(nil);
    }
    const group =
      candidates.find((t) => isGroup(t) && !/igst/i.test(nameOf(t))) ??
      candidates.find((t) => /^gst/i.test(nameOf(t)) && !/igst/i.test(nameOf(t)));
    return idOf(group);
  }
}

function isGroup(t: TaxLike): boolean {
  return t.tax_type === 'tax_group' || t.tax_group_id !== undefined;
}
function percentOf(t: TaxLike): number {
  return Number(t.tax_percentage ?? t.tax_group_percentage ?? Number.NaN);
}
function nameOf(t: TaxLike): string {
  return String(t.tax_name ?? t.tax_group_name ?? '');
}
function idOf(t: TaxLike | undefined): string | undefined {
  return t ? (t.tax_id ?? t.tax_group_id) : undefined;
}
