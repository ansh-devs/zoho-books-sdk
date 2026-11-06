import type { GstTreatment } from '../types/common.js';
import { findState, isRetiredStateCode, stateFromGstin } from './states.js';
import { parseGstin } from './validation.js';

export type ProfileKind = 'business' | 'consumer' | 'overseas';

/** Who the invoice is for. A business with a GSTIN is B2B, one without is an unregistered business. */
export interface BillingProfile {
  kind: ProfileKind;
  /** Legal name, at most 200 characters. */
  legalName: string;
  email?: string;
  /** Business only. Its first two digits must match state. */
  gstin?: string;
  address?: string;
  city?: string;
  /** Indian state as code, GST prefix or name. */
  state?: string;
  /** Six digit PIN code. */
  pin?: string;
  /** Overseas only, any country other than India. */
  country?: string;
  /** Created by your system, not by a person. Such a profile never adopts a Zoho contact by email. */
  systemGenerated?: boolean;
}

/** Zoho gst_treatment for a profile. */
export function gstTreatmentOf(profile: BillingProfile): GstTreatment {
  if (profile.kind === 'overseas') return 'overseas';
  if (profile.kind === 'consumer') return 'consumer';
  return profile.gstin ? 'business_gst' : 'business_none';
}

/** Problems that would make an invoice invalid under GST Rule 46. Empty means valid. */
export function validateBillingProfile(profile: BillingProfile): string[] {
  const problems: string[] = [];
  const name = profile.legalName?.trim() ?? '';
  if (!name) problems.push('legalName is required');
  if (name.length > 200) problems.push('legalName must be at most 200 characters');
  if (profile.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) problems.push('email is invalid');

  if (profile.gstin !== undefined) {
    if (profile.kind !== 'business') problems.push('gstin is only allowed on a business profile');
    const info = parseGstin(profile.gstin);
    if (!info.valid) problems.push(`gstin is invalid: ${info.reason}`);
    const fromGstin = stateFromGstin(profile.gstin);
    const chosen = profile.state ? findState(profile.state) : undefined;
    if (info.valid && chosen && fromGstin && chosen.code !== fromGstin.code) {
      problems.push(`gstin belongs to ${fromGstin.name}, but state is ${chosen.name}`);
    }
  }

  if (profile.kind === 'overseas') {
    const country = profile.country?.trim().toUpperCase();
    if (!country) problems.push('country is required for an overseas profile');
    else if (country === 'INDIA' || country === 'IN') problems.push('an overseas profile needs a country other than India');
    return problems;
  }

  const required = profile.kind === 'business';
  if (required && !profile.address?.trim()) problems.push('address is required');
  if (required && !profile.city?.trim()) problems.push('city is required');
  if (required && !profile.pin) problems.push('pin is required');
  if (profile.pin !== undefined && !/^[1-9]\d{5}$/.test(profile.pin.trim())) problems.push('pin must be 6 digits');
  if (required && !profile.state) problems.push('state is required');
  if (profile.state !== undefined) {
    if (isRetiredStateCode(profile.state)) problems.push(`state code ${profile.state} is retired`);
    else if (!findState(profile.state)) problems.push(`state ${profile.state} is unknown`);
  }
  return problems;
}

/** A date as YYYY MM DD in the given time zone, the form Zoho expects. India time by default. */
export function toZohoDate(date: Date = new Date(), timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
