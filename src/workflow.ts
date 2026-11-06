import type { ZohoBooks } from './client.js';
import { ZohoConfigError, ZohoGstError, ZohoNoRecordError, ZohoRateLimitError } from './errors.js';
import { gstTreatmentOf, toZohoDate, validateBillingProfile, type BillingProfile } from './gst/profile.js';
import { findState, toPlaceOfSupply } from './gst/states.js';
import { resultCode, settle } from './result.js';
import type { Contact, ContactInput, Invoice } from './types/models.js';

export interface InvoiceLine {
  itemId?: string;
  name?: string;
  description?: string;
  quantity: number;
  /** Unit price in paise. */
  unitAmountMinor: number;
  /** GST rate in percent. */
  gstRate: number;
  hsnOrSac?: string;
}

export interface InvoiceOrder {
  /** Your order id. Sent as reference_number and used to find an earlier attempt. */
  reference: string;
  /** When the payment was captured. Dated in India time. */
  paidAt: Date;
  /** Currency of the capture. Anything other than INR is held. */
  currency: string;
  profile: BillingProfile;
  lines: InvoiceLine[];
  /** Line amounts include tax. Use for legacy orders that only have a gross total. */
  inclusiveOfTax?: boolean;
  /** Amount actually captured, in paise. */
  capturedMinor: number;
  payment: {
    /** Gateway payment id, sent as the payment's reference_number. */
    reference: string;
    /** creditcard for card gateways, others for the rest. */
    mode: string;
    /** Zoho account the money is deposited to. */
    depositAccountId: string;
  };
  notes?: string;
}

/** Zoho ids created so far. Persist it after every step. */
export interface WorkflowState {
  contactId?: string;
  invoiceId?: string;
  paymentId?: string;
  einvoicePushed?: boolean;
  emailed?: boolean;
}

/** done finished. held needs a person. review means totals differ and nothing was recorded.
 * retry counts as a failed attempt. rate_limited does not, and should stop the batch. */
export type WorkflowOutcome =
  | { status: 'done'; state: WorkflowState }
  | { status: 'held' | 'review'; reason: string; state: WorkflowState }
  | { status: 'retry'; reason: string; error: unknown; state: WorkflowState }
  | { status: 'rate_limited'; error: unknown; state: WorkflowState };

/** Return a reason to hold the order, or undefined to let it through. */
export type HoldRule = (order: InvoiceOrder) => string | undefined;

export interface InvoiceWorkflowOptions {
  /** Called after every step so a crash resumes instead of creating duplicates. */
  save: (state: WorkflowState) => Promise<void> | void;
  /** Push B2B invoices to the IRP before emailing them. Turn on if your org uses e invoicing. */
  einvoicing?: boolean;
  /** Largest gap between Zoho's total and the captured amount, settled at Zoho's figure. Default 0.05. */
  tolerance?: number;
  /** Extra hold rules, e.g. an unknown product. */
  holdRules?: HoldRule[];
  /** How to invoice overseas customers. Without it they are held. */
  exportMode?: 'lut' | 'igst';
  /** Time zone for invoice and payment dates. Default Asia/Kolkata. */
  timeZone?: string;
}

/** Retry delays in minutes after each failed attempt. After the last one, stop and alert. */
export const RETRY_SCHEDULE_MINUTES: readonly number[] = Object.freeze([2, 10, 60, 360, 1440]);

/** When to retry after this many failed attempts, or undefined once the schedule is used up. */
export function nextRetryAt(failedAttempts: number, now: Date = new Date(), schedule: readonly number[] = RETRY_SCHEDULE_MINUTES): Date | undefined {
  const minutes = schedule[failedAttempts - 1];
  return minutes === undefined ? undefined : new Date(now.getTime() + minutes * 60_000);
}

/** Zoho contact fields for a billing profile. */
export function contactFromProfile(profile: BillingProfile): ContactInput {
  const treatment = gstTreatmentOf(profile);
  const state = profile.state ? findState(profile.state) : undefined;
  return {
    contact_name: profile.legalName,
    ...(profile.kind === 'business' ? { company_name: profile.legalName } : {}),
    contact_type: 'customer',
    customer_sub_type: profile.kind === 'business' ? 'business' : 'individual',
    gst_treatment: treatment,
    ...(treatment === 'business_gst' && profile.gstin ? { gst_no: profile.gstin.trim().toUpperCase() } : {}),
    ...(state ? { place_of_contact: toPlaceOfSupply(state.code)! } : {}),
    billing_address: {
      ...(profile.address ? { address: profile.address } : {}),
      ...(profile.city ? { city: profile.city } : {}),
      ...(state ? { state: state.name } : {}),
      ...(profile.pin ? { zip: profile.pin } : {}),
      country: profile.kind === 'overseas' ? (profile.country ?? '') : 'India',
    },
  };
}

/** Contact, invoice, payment, IRP push and email for one paid order, resumable from saved ids. */
export class InvoiceWorkflow {
  constructor(
    private readonly books: ZohoBooks,
    private readonly options: InvoiceWorkflowOptions,
  ) {}

  /** Why this order must not be invoiced automatically, or undefined. */
  holdReason(order: InvoiceOrder): string | undefined {
    if (order.currency.toUpperCase() !== 'INR') return `Currency ${order.currency} is not INR`;
    if (order.profile.kind === 'overseas' && !this.options.exportMode) return 'Overseas customer and no exportMode configured';
    const problems = validateBillingProfile(order.profile);
    if (problems.length) return `Billing profile: ${problems.join('; ')}`;
    for (const rule of this.options.holdRules ?? []) {
      const reason = rule(order);
      if (reason) return reason;
    }
    return undefined;
  }

  async run(order: InvoiceOrder, saved: WorkflowState = {}): Promise<WorkflowOutcome> {
    const state: WorkflowState = { ...saved };
    const save = () => this.options.save({ ...state });
    const log = this.books.log;
    const at = (fields: Record<string, unknown> = {}) => ({ organizationId: this.books.organizationId, reference: order.reference, ...fields });
    const step = (name: string, action: string, fields: Record<string, unknown> = {}) =>
      log.info('workflow', 'zoho.workflow.step', `${name} ${action}`, at({ step: name, action, ...fields }));
    const finish = (outcome: WorkflowOutcome): WorkflowOutcome => {
      const ids = { contactId: state.contactId, invoiceId: state.invoiceId, paymentId: state.paymentId };
      if (outcome.status === 'done') log.info('workflow', 'zoho.workflow.done', 'Order invoiced', at(ids));
      else if (outcome.status === 'held') log.warn('workflow', 'zoho.workflow.held', outcome.reason, at(ids));
      else if (outcome.status === 'review') log.error('workflow', 'zoho.workflow.review', outcome.reason, at(ids));
      else if (outcome.status === 'rate_limited') log.warn('workflow', 'zoho.workflow.rate_limited', 'Zoho rate limit; stop the batch', at(ids));
      else if (outcome.status === 'retry') log.warn('workflow', 'zoho.workflow.retry', outcome.reason, at({ ...ids, code: resultCode(outcome.error) }));
      return outcome;
    };

    const hold = this.holdReason(order);
    if (hold) return finish({ status: 'held', reason: hold, state });

    try {
      if (!state.contactId) {
        const contact = await this.contact(order.profile);
        state.contactId = contact.id;
        await save();
        step('contact', contact.adopted ? 'adopted' : 'created', { contactId: contact.id });
      }

      let invoice: Invoice;
      if (state.invoiceId) {
        invoice = await this.books.invoices.get(state.invoiceId);
        step('invoice', 'resumed', { invoiceId: state.invoiceId });
      } else {
        const existing = await this.books.invoices.findByReference(order.reference);
        invoice = existing ?? (await this.createInvoice(order, state.contactId));
        if (!invoice.invoice_id) throw new ZohoNoRecordError('Zoho returned no invoice_id', { status: 200, body: invoice });
        state.invoiceId = invoice.invoice_id;
        await save();
        step('invoice', existing ? 'adopted' : 'created', { invoiceId: invoice.invoice_id, total: invoice.total });
      }

      // Zoho rounds tax per line, so allow a small gap and settle at its figure. Never record money not received.
      const captured = order.capturedMinor / 100;
      const total = Number(invoice.total);
      if (!Number.isFinite(total) || Math.round(Math.abs(total - captured) * 100) > Math.round((this.options.tolerance ?? 0.05) * 100)) {
        return finish({ status: 'review', reason: `Zoho total ${invoice.total} differs from captured ${captured.toFixed(2)}`, state });
      }

      if (!state.paymentId && invoice.status !== 'paid') {
        const payment = await this.books.customerPayments.create({
          customer_id: state.contactId,
          payment_mode: order.payment.mode,
          amount: total,
          date: toZohoDate(order.paidAt, this.options.timeZone),
          reference_number: order.payment.reference,
          account_id: order.payment.depositAccountId,
          invoices: [{ invoice_id: state.invoiceId, amount_applied: total }],
        });
        if (!payment.payment_id) throw new ZohoNoRecordError('Zoho returned no payment_id', { status: 200, body: payment });
        state.paymentId = payment.payment_id;
        await save();
        step('payment', 'recorded', { paymentId: payment.payment_id, amount: total });
      } else if (!state.paymentId) {
        step('payment', 'skipped', { reason: 'invoice already paid' });
      }

      const email = order.profile.email;
      const b2b = gstTreatmentOf(order.profile) === 'business_gst';
      if (this.options.einvoicing && b2b && !state.einvoicePushed) {
        const pushed = await settle(this.books.invoices.einvoice.push(state.invoiceId));
        if (pushed.success) {
          step('einvoice', 'pushed');
        } else {
          if (pushed.code === 'RATE_LIMITED') return finish({ status: 'rate_limited', error: pushed.error, state });
          log.warn('workflow', 'zoho.einvoice.push_failed', pushed.error.message, at({ invoiceId: state.invoiceId, code: pushed.code }));
          // Zoho refuses a second push. If the email goes through, the invoice was already registered.
          if (!email) return finish({ status: 'retry', reason: 'IRP push failed', error: pushed.error, state });
          const sent = await settle(this.books.invoices.email(state.invoiceId, { to_mail_ids: [email] }));
          if (!sent.success) {
            if (sent.code === 'RATE_LIMITED') return finish({ status: 'rate_limited', error: sent.error, state });
            return finish({ status: 'retry', reason: 'IRP push failed', error: pushed.error, state });
          }
          log.info('workflow', 'zoho.einvoice.already_registered', 'Push was refused but the email went through, so the invoice is registered', at({ invoiceId: state.invoiceId }));
          state.emailed = true;
          step('email', 'sent');
        }
        state.einvoicePushed = true;
        await save();
      }

      if (email && !state.emailed) {
        await this.books.invoices.email(state.invoiceId, { to_mail_ids: [email] });
        state.emailed = true;
        await save();
        step('email', 'sent');
      }
      return finish({ status: 'done', state });
    } catch (error) {
      if (error instanceof ZohoRateLimitError) return finish({ status: 'rate_limited', error, state });
      if (error instanceof ZohoGstError || error instanceof ZohoConfigError) return finish({ status: 'held', reason: error.message, state });
      return finish({ status: 'retry', reason: error instanceof Error ? error.message : String(error), error, state });
    }
  }

  /** Reuse a contact found by email, updated with the current GST details, or create one. */
  private async contact(profile: BillingProfile): Promise<{ id: string; adopted: boolean }> {
    const fields = contactFromProfile(profile);
    // A system generated consumer must not adopt a contact an accountant may have set up with a GSTIN.
    if (profile.email && !profile.systemGenerated) {
      const existing = await this.books.contacts.findByEmail(profile.email);
      if (existing) {
        await this.books.contacts.update(existing.contact_id, fields);
        return { id: existing.contact_id, adopted: true };
      }
    }
    const created = await this.books.contacts.create({
      ...fields,
      ...(profile.email ? { contact_persons: [{ first_name: profile.legalName, email: profile.email, is_primary_contact: true }] } : {}),
    });
    if (!created.contact_id) throw new ZohoNoRecordError('Zoho returned no contact_id', { status: 200, body: created });
    return { id: created.contact_id, adopted: false };
  }

  private async createInvoice(order: InvoiceOrder, contactId: string): Promise<Invoice> {
    const fields = contactFromProfile(order.profile);
    const contact = { contact_id: contactId, contact_name: order.profile.legalName, ...fields } as Contact;
    const { payload } = await this.books.gst.prepareInvoice(
      {
        customer_id: contactId,
        date: toZohoDate(order.paidAt, this.options.timeZone),
        reference_number: order.reference,
        is_inclusive_tax: order.inclusiveOfTax ?? false,
        ...(order.notes ? { notes: order.notes } : {}),
        line_items: order.lines.map((l) => ({
          ...(l.itemId ? { item_id: l.itemId } : {}),
          ...(l.name ? { name: l.name } : {}),
          ...(l.description ? { description: l.description } : {}),
          quantity: l.quantity,
          rate: l.unitAmountMinor / 100,
          gstRate: l.gstRate,
          ...(l.hsnOrSac ? { hsn_or_sac: l.hsnOrSac } : {}),
        })),
      },
      { contact, ...(this.options.exportMode ? { exportMode: this.options.exportMode } : {}) },
    );
    return this.books.invoices.create(payload);
  }
}
