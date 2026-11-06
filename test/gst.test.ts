import { describe, expect, it } from 'vitest';
import {
  GstTaxResolver,
  ZohoGstError,
  canCancelIrn,
  computeGst,
  determineSupplyType,
  findState,
  gstinChecksum,
  homeStateFromOrganization,
  isValidGstin,
  parseGstin,
  roundMoney,
  setStateCodeOverrides,
  stateFromGstin,
  toPlaceOfSupply,
  validateHsnOrSac,
} from '../src/index.js';
import { json, mockFetch, testClient } from './helpers.js';

describe('GSTIN', () => {
  it('validates a known-good GSTIN', () => {
    const info = parseGstin(' 27aapfu0939f1zv ');
    expect(info.valid).toBe(true);
    expect(info.gstin).toBe('27AAPFU0939F1ZV');
    expect(info.state?.code).toBe('MH');
    expect(info.pan).toBe('AAPFU0939F');
    expect(info.kind).toBe('regular');
  });

  it('rejects bad checksum, length and state', () => {
    expect(parseGstin('27AAPFU0939F1ZX')).toMatchObject({ valid: false, reason: expect.stringContaining('Checksum') });
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(parseGstin('00AAPFU0939F1ZV').reason).toContain('Unknown state');
  });

  it('checksum is deterministic', () => {
    expect(gstinChecksum('27AAPFU0939F1Z')).toBe('V');
    expect(gstinChecksum('29AAGCB7383J1Z')).toBe('4');
  });
});

describe('states', () => {
  it('resolves codes, GST codes, names and aliases', () => {
    expect(findState('KA')?.name).toBe('Karnataka');
    expect(findState('29')?.code).toBe('KA');
    expect(findState('tamil nadu')?.code).toBe('TN');
    expect(findState('Orissa')?.code).toBe('OD');
    expect(findState('28')).toBeUndefined(); // retired prefix
    expect(findState('37')?.code).toBe('AD');
    expect(findState('AP')?.code).toBe('AD');
    expect(stateFromGstin('28AAAAA0000A1Z5')?.code).toBe('AD');
    expect(stateFromGstin('36AAAAA0000A1Z5')?.code).toBe('TS');
    expect(toPlaceOfSupply('Delhi')).toBe('DL');
    expect(findState('XX')).toBeUndefined();
  });

  it('supports org-specific overrides', () => {
    setStateCodeOverrides({ OD: 'OR' });
    try {
      expect(toPlaceOfSupply('Odisha')).toBe('OR');
      expect(findState('OR')?.code).toBe('OD');
    } finally {
      setStateCodeOverrides({});
    }
  });
});

describe('HSN / SAC', () => {
  it('accepts valid codes', () => {
    expect(validateHsnOrSac('998314')).toMatchObject({ valid: true, kind: 'sac' });
    expect(validateHsnOrSac('8471')).toMatchObject({ valid: true, kind: 'hsn' });
    expect(validateHsnOrSac(84713010)).toMatchObject({ valid: true, kind: 'hsn' });
  });
  it('rejects invalid codes', () => {
    expect(validateHsnOrSac('84A1').valid).toBe(false);
    expect(validateHsnOrSac('12345').valid).toBe(false);
    expect(validateHsnOrSac('8471', { minDigits: 6 }).valid).toBe(false);
  });
});

describe('supply type & computation', () => {
  it('intra vs inter', () => {
    expect(determineSupplyType({ homeState: 'KA', placeOfSupply: 'Karnataka' })).toBe('intra');
    expect(determineSupplyType({ homeState: 'KA', placeOfSupply: 'MH' })).toBe('inter');
    expect(determineSupplyType({ homeState: 'KA', placeOfSupply: 'KA', gstTreatment: 'business_sez' })).toBe('inter');
    expect(determineSupplyType({ homeState: 'KA', placeOfSupply: undefined, gstTreatment: 'overseas' })).toBe('inter');
  });

  it('roundMoney avoids float artefacts', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(-1.005)).toBe(-1.01);
  });

  it('computes CGST/SGST split', () => {
    const r = computeGst([{ quantity: 2, rate: 499.5, gstRate: 18 }], { supplyType: 'intra' });
    expect(r.taxableValue).toBe(999);
    expect(r.cgst).toBe(89.91);
    expect(r.sgst).toBe(89.91);
    expect(r.igst).toBe(0);
    expect(r.total).toBe(1178.82);
  });

  it('computes IGST, discounts, cess, inclusive and round-off', () => {
    const r = computeGst(
      [
        { quantity: 1, rate: 1180, gstRate: 18 },
        { quantity: 1, rate: 1000, gstRate: 28, cessRate: 12, discount: '10%' },
      ],
      { supplyType: 'inter', inclusive: true, roundToRupee: true },
    );
    expect(r.lines[0]!.taxableValue).toBe(1000);
    expect(r.lines[0]!.igst).toBe(180);
    expect(r.lines[1]!.taxableValue).toBe(642.86); // 900 / 1.40
    expect(r.lines[1]!.cess).toBe(77.14);
    expect(r.grandTotal).toBe(Math.round(r.total));
    expect(roundMoney(r.total + r.roundOff)).toBe(r.grandTotal);
  });
});

const TAXES = [
  { tax_id: 'igst18', tax_name: 'IGST18', tax_percentage: 18, tax_type: 'tax', tax_specific_type: 'igst' },
  { tax_id: 'cgst9', tax_name: 'CGST9', tax_percentage: 9, tax_type: 'tax', tax_specific_type: 'cgst' },
  { tax_id: 'sgst9', tax_name: 'SGST9', tax_percentage: 9, tax_type: 'tax', tax_specific_type: 'sgst' },
  { tax_id: 'gst18', tax_name: 'GST18', tax_percentage: 18, tax_type: 'tax_group' },
  { tax_id: 'igst5', tax_name: 'IGST5', tax_percentage: 5, tax_type: 'tax', tax_specific_type: 'igst' },
  { tax_id: 'gst5', tax_name: 'GST5', tax_percentage: 5, tax_type: 'tax_group' },
];

describe('GstTaxResolver', () => {
  it('picks the group for intra and IGST for inter', () => {
    const r = new GstTaxResolver(TAXES);
    expect(r.resolve(18, 'intra')).toEqual({ id: 'gst18', field: 'tax_group_id' });
    expect(r.resolve(18, 'inter')).toEqual({ id: 'igst18', field: 'tax_id' });
    expect(r.resolve(5, 'inter')).toEqual({ id: 'igst5', field: 'tax_id' });
  });
  it('explicit taxMap wins', () => {
    expect(new GstTaxResolver(TAXES, { 18: { intra: 'custom' } }).resolve(18, 'intra')).toEqual({ id: 'custom', field: 'tax_group_id' });
  });
  it('throws a helpful error', () => {
    expect(() => new GstTaxResolver(TAXES).resolve(12, 'intra')).toThrow(/No CGST\+SGST group tax found for 12%.*Available/);
  });
});

describe('client.gst helper', () => {
  function setup(contact: Record<string, unknown>, org: Record<string, unknown> = { organization_id: '600000001', address: { state: 'Karnataka' } }) {
    const m = mockFetch()
      .on('GET', '/organizations/600000001', () => json({ code: 0, message: 'ok', organization: org }))
      .on('GET', '/settings/taxes', () => json({ code: 0, message: 'ok', taxes: TAXES, page_context: { page: 1, per_page: 200, has_more_page: false } }))
      .on('GET', /\/contacts\/.+/, () => json({ code: 0, message: 'ok', contact }))
      .on('POST', '/invoices', (call) => json({ code: 0, message: 'ok', invoice: { invoice_id: 'new', ...(call.body as object) } }));
    return { m, books: testClient(m.fetch) };
  }

  it('intra-state B2B invoice gets the CGST+SGST group and KA place of supply', async () => {
    const { m, books } = setup({ contact_id: 'c1', gst_treatment: 'business_gst', gst_no: '29AAGCB7383J1Z4', place_of_contact: 'KA' });
    const inv = await books.gst.createInvoice(
      { customer_id: 'c1', line_items: [{ item_id: 'i1', quantity: 1, rate: 100, gstRate: 18, hsn_or_sac: '998314' }] },
      { send: false },
    );
    expect(inv.invoice_id).toBe('new');
    const post = m.calls.find((c) => c.method === 'POST')!;
    expect(post.body).toMatchObject({
      customer_id: 'c1',
      gst_treatment: 'business_gst',
      gst_no: '29AAGCB7383J1Z4',
      place_of_supply: 'KA',
      line_items: [{ item_id: 'i1', tax_group_id: 'gst18', hsn_or_sac: '998314' }],
    });
    expect((post.body as { line_items: Array<Record<string, unknown>> }).line_items[0]).not.toHaveProperty('gstRate');
  });

  it('inter-state customer gets IGST, place of supply derived from GSTIN', async () => {
    const { books } = setup({ contact_id: 'c2', gst_treatment: 'business_gst', gst_no: '27AAPFU0939F1ZV' });
    const res = await books.gst.prepareInvoice({ customer_id: 'c2', line_items: [{ rate: 100, quantity: 1, gstRate: 18 }] });
    expect(res.supplyType).toBe('inter');
    expect(res.placeOfSupply).toBe('MH');
    expect(res.payload.line_items![0]!.tax_id).toBe('igst18');
  });

  it('caches org + taxes across calls', async () => {
    const { m, books } = setup({ contact_id: 'c', gst_treatment: 'consumer', place_of_contact: 'KA' });
    await books.gst.prepareInvoice({ customer_id: 'c', line_items: [{ rate: 1, quantity: 1, gstRate: 5 }] });
    await books.gst.prepareInvoice({ customer_id: 'c', line_items: [{ rate: 1, quantity: 1, gstRate: 5 }] });
    expect(m.calls.filter((c) => c.url.pathname.endsWith('/settings/taxes'))).toHaveLength(1);
    expect(m.calls.filter((c) => c.url.pathname.includes('/organizations/'))).toHaveLength(1);
  });

  it('rejects invalid GSTIN and missing GSTIN for B2B, before any write', async () => {
    const bad = setup({ contact_id: 'c', gst_treatment: 'business_gst', gst_no: '29AAGCB7383J1Z5' });
    await expect(bad.books.gst.createInvoice({ customer_id: 'c', line_items: [] })).rejects.toBeInstanceOf(ZohoGstError);
    expect(bad.m.calls.some((c) => c.method === 'POST')).toBe(false);

    const missing = setup({ contact_id: 'c', gst_treatment: 'business_gst' });
    await expect(missing.books.gst.prepareInvoice({ customer_id: 'c', line_items: [] })).rejects.toThrow(/requires the customer's GSTIN/);
  });

  it('honours an explicit tax_id on a line', async () => {
    const { books } = setup({ contact_id: 'c', gst_treatment: 'consumer', place_of_contact: 'KA' });
    const res = await books.gst.prepareInvoice({ customer_id: 'c', line_items: [{ rate: 1, quantity: 1, gstRate: 18, tax_id: 'mine' }] });
    expect(res.payload.line_items![0]!.tax_id).toBe('mine');
  });

  it('homeStateFromOrganization reads address or GSTIN', () => {
    expect(homeStateFromOrganization({ organization_id: '1', name: 'x', address: { state_code: 'TN' } })).toBe('TN');
    expect(homeStateFromOrganization({ organization_id: '1', name: 'x', gst_no: '27AAPFU0939F1ZV' })).toBe('MH');
    expect(homeStateFromOrganization({ organization_id: '1', name: 'x' })).toBeUndefined();
  });
});

describe('IRN cancellation window', () => {
  it('allows cancellation within 24h only', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    expect(canCancelIrn('2026-11-05T00:00:00Z', now)).toBe(true);
    expect(canCancelIrn('2026-11-04T11:00:00Z', now)).toBe(false);
    expect(canCancelIrn(undefined, now)).toBe(false);
  });
});
