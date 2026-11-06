/** Indian state with its GSTIN prefix and the two letter code Zoho uses for place of supply.
 * Zoho does not publish the letter codes, so they can be remapped with setStateCodeOverrides. */
export interface IndianState {
  /** GSTIN prefix, e.g. 33. */
  gstCode: string;
  /** Place of supply code, e.g. TN. */
  code: string;
  name: string;
  isUnionTerritory: boolean;
}

const RAW: Array<[string, string, string, boolean]> = [
  ['01', 'JK', 'Jammu and Kashmir', true],
  ['02', 'HP', 'Himachal Pradesh', false],
  ['03', 'PB', 'Punjab', false],
  ['04', 'CH', 'Chandigarh', true],
  ['05', 'UK', 'Uttarakhand', false],
  ['06', 'HR', 'Haryana', false],
  ['07', 'DL', 'Delhi', true],
  ['08', 'RJ', 'Rajasthan', false],
  ['09', 'UP', 'Uttar Pradesh', false],
  ['10', 'BR', 'Bihar', false],
  ['11', 'SK', 'Sikkim', false],
  ['12', 'AR', 'Arunachal Pradesh', false],
  ['13', 'NL', 'Nagaland', false],
  ['14', 'MN', 'Manipur', false],
  ['15', 'MZ', 'Mizoram', false],
  ['16', 'TR', 'Tripura', false],
  ['17', 'ML', 'Meghalaya', false],
  ['18', 'AS', 'Assam', false],
  ['19', 'WB', 'West Bengal', false],
  ['20', 'JH', 'Jharkhand', false],
  ['21', 'OD', 'Odisha', false],
  ['22', 'CG', 'Chhattisgarh', false],
  ['23', 'MP', 'Madhya Pradesh', false],
  ['24', 'GJ', 'Gujarat', false],
  ['26', 'DN', 'Dadra and Nagar Haveli and Daman and Diu', true],
  ['27', 'MH', 'Maharashtra', false],
  ['29', 'KA', 'Karnataka', false],
  ['30', 'GA', 'Goa', false],
  ['31', 'LD', 'Lakshadweep', true],
  ['32', 'KL', 'Kerala', false],
  ['33', 'TN', 'Tamil Nadu', false],
  ['34', 'PY', 'Puducherry', true],
  ['35', 'AN', 'Andaman and Nicobar Islands', true],
  ['36', 'TS', 'Telangana', false],
  ['37', 'AP', 'Andhra Pradesh', false],
  ['38', 'LA', 'Ladakh', true],
  ['97', 'OT', 'Other Territory', true],
];

/** Old GSTIN prefixes still seen on existing registrations. */
const LEGACY_GST_CODES: Record<string, string> = {
  '25': 'DN', // Daman and Diu, merged into 26 in 2020
  '28': 'AP', // Andhra Pradesh before the 2014 split
};

/** Other spellings and codes in common use. */
const ALIASES: Record<string, string> = {
  OR: 'OD',
  ORISSA: 'OD',
  TG: 'TS',
  UT: 'UK',
  UTTARANCHAL: 'UK',
  CT: 'CG',
  DD: 'DN',
  PONDICHERRY: 'PY',
  'NEW DELHI': 'DL',
  'NCT OF DELHI': 'DL',
};

export const INDIAN_STATES: readonly IndianState[] = Object.freeze(
  RAW.map(([gstCode, code, name, isUnionTerritory]) => Object.freeze({ gstCode, code, name, isUnionTerritory })),
);

let overrides: Record<string, string> = {};

/** Remap state codes to what your Zoho org accepts, e.g. { OD: 'OR' }. */
export function setStateCodeOverrides(map: Record<string, string>): void {
  overrides = { ...map };
}

function applyOverride(code: string): string {
  return overrides[code] ?? code;
}

const byCode = new Map(INDIAN_STATES.map((s) => [s.code, s]));
const byGst = new Map(INDIAN_STATES.map((s) => [s.gstCode, s]));
const byName = new Map(INDIAN_STATES.map((s) => [s.name.toUpperCase(), s]));

/** State from a letter code, GSTIN prefix or name, ignoring case. undefined when unknown. */
export function findState(input: string | undefined | null): IndianState | undefined {
  if (!input) return undefined;
  const raw = input.trim().toUpperCase();
  if (!raw) return undefined;
  const reverse = Object.entries(overrides).find(([, v]) => v === raw)?.[0];
  const key = reverse ?? ALIASES[raw] ?? raw;
  return (
    byCode.get(key) ??
    byGst.get(key.padStart(2, '0')) ??
    (LEGACY_GST_CODES[key] ? byCode.get(LEGACY_GST_CODES[key]!) : undefined) ??
    byName.get(key) ??
    byName.get(raw.replace(/&/g, 'AND').replace(/\s+/g, ' '))
  );
}

/** Place of supply code for any state code, prefix or name. */
export function toPlaceOfSupply(input: string | undefined | null): string | undefined {
  const s = findState(input);
  return s ? applyOverride(s.code) : undefined;
}

/** State from the first two digits of a GSTIN. */
export function stateFromGstin(gstin: string): IndianState | undefined {
  const prefix = gstin.trim().slice(0, 2);
  if (!/^\d{2}$/.test(prefix)) return undefined;
  return byGst.get(prefix) ?? (LEGACY_GST_CODES[prefix] ? byCode.get(LEGACY_GST_CODES[prefix]!) : undefined);
}
