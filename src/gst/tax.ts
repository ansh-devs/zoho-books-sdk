import type { GstTreatment } from '../types/common.js';
import { findState } from './states.js';

/** `intra` → CGST + SGST/UTGST; `inter` → IGST. */
export type SupplyType = 'intra' | 'inter';

/** Treatments that are always zero-rated / inter-state supplies under IGST. */
const ALWAYS_INTER: ReadonlySet<string> = new Set(['overseas', 'business_sez', 'deemed_export']);

export interface SupplyTypeInput {
  /** Supplier's (organization / location) state: code, GST code or name. */
  homeState: string;
  /** Place of supply: code, GST code or name. */
  placeOfSupply: string | undefined;
  gstTreatment?: GstTreatment | undefined;
}

/**
 * Decide intra- vs inter-state supply (IGST Act s.7/s.8): exports and SEZ
 * supplies are always inter-state; otherwise compare supplier state with
 * place of supply.
 */
export function determineSupplyType(input: SupplyTypeInput): SupplyType {
  if (input.gstTreatment && ALWAYS_INTER.has(input.gstTreatment)) return 'inter';
  const home = findState(input.homeState);
  if (!home) throw new TypeError(`Unknown home state "${input.homeState}"`);
  if (!input.placeOfSupply) return 'intra';
  const pos = findState(input.placeOfSupply);
  if (!pos) throw new TypeError(`Unknown place of supply "${input.placeOfSupply}"`);
  return home.code === pos.code ? 'intra' : 'inter';
}

/** Round half away from zero to `decimals` (money-safe for 2 dp). */
export function roundMoney(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  const n = Math.abs(value) * f;
  // Nudge by epsilon to defeat binary artefacts like 1.005 → 1.00499999.
  const r = Math.round(n + 1e-9 * Math.max(1, n));
  return (Math.sign(value) * r) / f;
}

export interface GstLineInput {
  quantity: number;
  rate: number;
  /** GST rate in percent, e.g. 18. */
  gstRate: number;
  /** Compensation cess rate in percent. */
  cessRate?: number;
  /** Discount: flat amount, or percentage string like `"10%"`. */
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
  /** Round-off to the nearest rupee, if requested (use as Zoho `adjustment`). */
  roundOff: number;
  grandTotal: number;
}

export interface ComputeGstOptions {
  supplyType: SupplyType;
  /** Line rates include tax (Zoho `is_inclusive_tax`). */
  inclusive?: boolean;
  /** Round the grand total to whole rupees and report the difference. */
  roundToRupee?: boolean;
}

/**
 * Compute a GST breakdown locally — for previews, reconciliation against
 * Zoho's totals, or building e-invoice payloads. Each component is rounded per
 * line (as GSTN/IRP expects), with CGST and SGST split evenly.
 */
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

/** Minimal shape of a Zoho tax / tax group entry from `GET /settings/taxes`. */
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

/** Explicit mapping `{ 18: { intra: '<GST18 group id>', inter: '<IGST18 id>' } }`. */
export type GstTaxMap = Record<number, Partial<Record<SupplyType, string>>>;

/**
 * Picks the right Zoho `tax_id` for a GST rate and supply type from the
 * org's configured taxes: IGST x% for inter-state, the CGST+SGST tax group
 * for intra-state. An explicit `taxMap` always wins.
 */
export class GstTaxResolver {
  private readonly taxes: TaxLike[];
  private readonly taxMap: GstTaxMap;

  constructor(taxes: TaxLike[], taxMap: GstTaxMap = {}) {
    this.taxes = taxes.filter((t) => t.status === undefined || t.status === 'active');
    this.taxMap = taxMap;
  }

  /** Return the tax id, or throw with a helpful list of what's configured. */
  resolve(rate: number, supplyType: SupplyType): string {
    const id = this.tryResolve(rate, supplyType);
    if (id) return id;
    const available = this.taxes
      .map((t) => `${t.tax_name ?? t.tax_group_name} (${percentOf(t)}%${t.tax_specific_type ? `, ${t.tax_specific_type}` : ''}${isGroup(t) ? ', group' : ''})`)
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
        candidates.find((t) => !isGroup(t) && /igst/i.test(t.tax_name ?? ''));
      return idOf(igst);
    }
    if (rate === 0) {
      const nil = candidates.find((t) => t.tax_specific_type === 'nil' || /nil|exempt|zero/i.test(t.tax_name ?? ''));
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
