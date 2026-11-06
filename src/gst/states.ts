/** Indian state with its GSTIN prefix and the two letter code Zoho uses for place of supply. */
export interface IndianState {
  /** GSTIN prefix, e.g. 33. */
  gstCode: string;
  /** Zoho place of supply code, e.g. TN. */
  code: string;
  name: string;
  isUnionTerritory: boolean;
}

// Zoho uses AD for Andhra Pradesh and UK for Uttarakhand, verified in production.
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
  ['37', 'AD', 'Andhra Pradesh', false],
  ['38', 'LA', 'Ladakh', true],
  ['97', 'OT', 'Other Territory', true],
];

/** Retired prefixes. Valid on old GSTINs, refused as a place of supply for new data. */
const RETIRED_GST_CODES: Record<string, string> = {
  '25': 'DN',
  '28': 'AD',
};

/** Retired letter codes, refused for new data. */
const RETIRED_CODES = new Set(['DD']);

/** Other spellings and codes in common use, mapped to Zoho's code. */
const ALIASES: Record<string, string> = {
  AP: 'AD',
  OR: 'OD',
  ORISSA: 'OD',
  TG: 'TS',
  UT: 'UK',
  UTTARANCHAL: 'UK',
  CT: 'CG',
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

/** True for a retired GSTIN prefix or letter code such as 25, 28 or DD. */
export function isRetiredStateCode(input: string): boolean {
  const raw = input.trim().toUpperCase();
  return RETIRED_CODES.has(raw) || raw.padStart(2, '0') in RETIRED_GST_CODES;
}

/** Current state from a letter code, GSTIN prefix or name, ignoring case. Retired codes give undefined. */
export function findState(input: string | undefined | null): IndianState | undefined {
  if (!input) return undefined;
  const raw = input.trim().toUpperCase();
  if (!raw || isRetiredStateCode(raw)) return undefined;
  const reverse = Object.entries(overrides).find(([, v]) => v === raw)?.[0];
  const key = reverse ?? ALIASES[raw] ?? raw;
  return (
    byCode.get(key) ??
    (/^\d{1,2}$/.test(key) ? byGst.get(key.padStart(2, '0')) : undefined) ??
    byName.get(key) ??
    byName.get(raw.replace(/&/g, 'AND').replace(/\s+/g, ' '))
  );
}

/** Zoho place of supply code for any current state code, prefix or name. */
export function toPlaceOfSupply(input: string | undefined | null): string | undefined {
  const s = findState(input);
  return s ? applyOverride(s.code) : undefined;
}

/** State from the first two digits of a GSTIN, including retired prefixes on old registrations. */
export function stateFromGstin(gstin: string): IndianState | undefined {
  const prefix = gstin.trim().slice(0, 2);
  if (!/^\d{2}$/.test(prefix)) return undefined;
  const retired = RETIRED_GST_CODES[prefix];
  return byGst.get(prefix) ?? (retired ? byCode.get(retired) : undefined);
}
