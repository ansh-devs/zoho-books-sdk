import type {
  Address,
  CommonListParams,
  ContactPersonRef,
  CustomFieldValue,
  GstTreatment,
  LineItem,
  LineItemInput,
  LooseString,
  ProductType,
  ReportingTag,
  SalesDocument,
  SalesDocumentInput,
  TaxTreatment,
  ZohoDate,
} from './common.js';

// ───────────────────────────── Organizations ─────────────────────────────

export interface Organization {
  organization_id: string;
  name: string;
  contact_name?: string;
  email?: string;
  is_default_org?: boolean;
  plan_type?: number;
  plan_name?: string;
  currency_id?: string;
  currency_code?: string;
  currency_symbol?: string;
  country?: string;
  country_code?: string;
  time_zone?: string;
  date_format?: string;
  fiscal_year_start_month?: number;
  /** e.g. `in`, `us`, `uk`, `uae` — drives which fields are valid. */
  version?: string;
  is_org_active?: boolean;
  [key: string]: unknown;
}

// ───────────────────────────── Contacts ─────────────────────────────

export interface ContactPersonInput {
  contact_person_id?: string;
  salutation?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  designation?: string;
  department?: string;
  is_primary_contact?: boolean;
  enable_portal?: boolean;
  communication_preference?: ContactPersonRef['communication_preference'];
  [key: string]: unknown;
}

export interface ContactPerson extends ContactPersonInput {
  contact_person_id: string;
}

export interface ContactInput {
  contact_name?: string;
  company_name?: string;
  contact_type?: LooseString<'customer' | 'vendor'>;
  customer_sub_type?: LooseString<'individual' | 'business'>;
  website?: string;
  language_code?: string;
  credit_limit?: number;
  contact_number?: string;
  currency_id?: string;
  payment_terms?: number;
  payment_terms_label?: string;
  notes?: string;
  billing_address?: Address;
  shipping_address?: Address;
  contact_persons?: ContactPersonInput[];
  custom_fields?: CustomFieldValue[];
  tags?: ReportingTag[];
  owner_id?: string;
  pricebook_id?: string;
  is_portal_enabled?: boolean;
  is_taxable?: boolean;
  tax_id?: string;
  tds_tax_id?: string;
  tax_exemption_id?: string;
  tax_exemption_code?: string;
  // India GST
  gst_treatment?: GstTreatment;
  /** 15-character GSTIN. */
  gst_no?: string;
  /** India: 2-letter state/UT code where the contact is located. */
  place_of_contact?: string;
  legal_name?: string;
  trader_name?: string;
  // GCC / UK / other
  tax_treatment?: TaxTreatment;
  tax_reg_no?: string;
  vat_reg_no?: string;
  vat_treatment?: string;
  country_code?: string;
  place_of_supply?: string;
  [key: string]: unknown;
}

export interface Contact extends ContactInput {
  contact_id: string;
  contact_name: string;
  status?: LooseString<'active' | 'inactive' | 'crm' | 'all'>;
  outstanding_receivable_amount?: number;
  outstanding_payable_amount?: number;
  unused_credits_receivable_amount?: number;
  primary_contact_id?: string;
  created_time?: string;
  last_modified_time?: string;
}

export interface ContactListParams extends CommonListParams {
  contact_name?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  contact_type?: 'customer' | 'vendor';
  status?: string;
}

// ───────────────────────────── Items ─────────────────────────────

export interface ItemTaxPreference {
  tax_id: string;
  /** India: `intra` (CGST+SGST) or `inter` (IGST). */
  tax_specification: LooseString<'intra' | 'inter'>;
  tax_name?: string;
  tax_percentage?: number;
}

export interface ItemInput {
  name?: string;
  rate?: number;
  description?: string;
  sku?: string;
  unit?: string;
  product_type?: ProductType | LooseString<'service'>;
  item_type?: LooseString<'sales' | 'purchases' | 'sales_and_purchases' | 'inventory'>;
  /** India: HSN (goods) / SAC (services) code. */
  hsn_or_sac?: string;
  tax_id?: string;
  is_taxable?: boolean;
  tax_exemption_id?: string;
  item_tax_preferences?: ItemTaxPreference[];
  account_id?: string;
  purchase_account_id?: string;
  purchase_rate?: number;
  purchase_description?: string;
  inventory_account_id?: string;
  vendor_id?: string;
  reorder_level?: number;
  custom_fields?: CustomFieldValue[];
  [key: string]: unknown;
}

export interface Item extends ItemInput {
  item_id: string;
  name: string;
  status?: LooseString<'active' | 'inactive'>;
  tax_name?: string;
  tax_percentage?: number;
}

export interface ItemListParams extends CommonListParams {
  name?: string;
  sku?: string;
  rate?: number;
  tax_id?: string;
}

// ───────────────────────────── Taxes & currency ─────────────────────────────

export interface TaxInput {
  tax_name?: string;
  tax_percentage?: number;
  tax_type?: LooseString<'tax' | 'compound_tax'>;
  /** India: `igst`, `cgst`, `sgst`, `nil`, `cess`. */
  tax_specific_type?: LooseString<'igst' | 'cgst' | 'sgst' | 'nil' | 'cess'>;
  tax_authority_id?: string;
  country_code?: string;
  is_value_added?: boolean;
  [key: string]: unknown;
}

export interface Tax extends TaxInput {
  tax_id: string;
  tax_name: string;
  tax_percentage: number;
  is_default_tax?: boolean;
  is_editable?: boolean;
}

export interface TaxGroupInput {
  tax_group_name: string;
  /** Comma-separated tax ids, e.g. CGST id + SGST id. */
  taxes: string;
}

export interface TaxGroup {
  tax_group_id: string;
  tax_group_name: string;
  tax_group_percentage?: number;
  taxes?: Tax[];
  [key: string]: unknown;
}

export interface Currency {
  currency_id: string;
  currency_code: string;
  currency_name?: string;
  currency_symbol?: string;
  price_precision?: number;
  currency_format?: string;
  is_base_currency?: boolean;
  exchange_rate?: number;
  [key: string]: unknown;
}

// ───────────────────────────── Sales documents ─────────────────────────────

export type InvoiceStatus = LooseString<
  'draft' | 'sent' | 'overdue' | 'paid' | 'void' | 'unpaid' | 'partially_paid' | 'viewed' | 'pending_approval' | 'approved'
>;

export interface InvoiceInput extends SalesDocumentInput {
  invoice_number?: string;
  payment_terms?: number;
  payment_terms_label?: string;
  due_date?: ZohoDate;
  allow_partial_payments?: boolean;
  custom_body?: string;
  custom_subject?: string;
  reason?: string;
  recurring_invoice_id?: string;
  invoiced_estimate_id?: string;
  salesorder_id?: string;
  payment_options?: {
    payment_gateways?: Array<{ gateway_name: string; configured?: boolean; additional_field1?: string }>;
  };
  /** India: invoice dated before GST rollout (July 2017). */
  is_pre_gst?: boolean;
}

export interface Invoice extends SalesDocument, InvoiceInput {
  line_items?: LineItem[];
  invoice_id: string;
  invoice_number: string;
  status: InvoiceStatus;
  balance?: number;
  payment_made?: number;
  credits_applied?: number;
  write_off_amount?: number;
  invoice_url?: string;
  /** India e-invoice details once pushed to the IRP. */
  einvoice_details?: EInvoiceDetails;
}

export interface InvoiceListParams extends CommonListParams {
  invoice_number?: string;
  invoice_number_startswith?: string;
  invoice_number_contains?: string;
  customer_name?: string;
  reference_number?: string;
  item_id?: string;
  item_name?: string;
  status?: InvoiceStatus;
  date?: ZohoDate;
  date_before?: ZohoDate;
  date_after?: ZohoDate;
  due_date?: ZohoDate;
  due_date_start?: ZohoDate;
  due_date_end?: ZohoDate;
  recurring_invoice_id?: string;
  response_option?: 0 | 1 | 2 | 3 | 4;
}

export interface EstimateInput extends SalesDocumentInput {
  estimate_number?: string;
  expiry_date?: ZohoDate;
  custom_body?: string;
  custom_subject?: string;
}

export interface Estimate extends SalesDocument, EstimateInput {
  line_items?: LineItem[];
  estimate_id: string;
  estimate_number: string;
}

export interface SalesOrderInput extends SalesDocumentInput {
  salesorder_number?: string;
  shipment_date?: ZohoDate;
  delivery_method?: string;
  estimate_id?: string;
}

export interface SalesOrder extends SalesDocument, SalesOrderInput {
  line_items?: LineItem[];
  salesorder_id: string;
  salesorder_number: string;
}

export interface CreditNoteInput extends SalesDocumentInput {
  creditnote_number?: string;
  is_draft?: boolean;
  reason_for_credit_debit_note?: string;
  ignore_auto_number_generation?: boolean;
}

export interface CreditNote extends SalesDocument, CreditNoteInput {
  line_items?: LineItem[];
  creditnote_id: string;
  creditnote_number: string;
  balance?: number;
  einvoice_details?: EInvoiceDetails;
}

export interface RecurringInvoiceInput extends SalesDocumentInput {
  recurrence_name?: string;
  start_date?: ZohoDate;
  end_date?: ZohoDate;
  recurrence_frequency?: LooseString<'days' | 'weeks' | 'months' | 'years'>;
  repeat_every?: number;
  payment_terms?: number;
  payment_terms_label?: string;
}

export interface RecurringInvoice extends SalesDocument, RecurringInvoiceInput {
  line_items?: LineItem[];
  recurring_invoice_id: string;
  recurrence_name: string;
}

export interface RetainerInvoiceInput extends SalesDocumentInput {
  retainerinvoice_number?: string;
}

export interface RetainerInvoice extends SalesDocument, RetainerInvoiceInput {
  line_items?: LineItem[];
  retainerinvoice_id: string;
  retainerinvoice_number?: string;
}

export interface SalesReceiptInput extends SalesDocumentInput {
  receipt_number?: string;
  payment_mode?: string;
  deposit_to_account_id?: string;
}

export interface SalesReceipt extends SalesDocument, SalesReceiptInput {
  line_items?: LineItem[];
  sales_receipt_id: string;
}

export interface DeliveryChallanInput extends SalesDocumentInput {
  deliverychallan_number?: string;
  challan_type?: LooseString<'job_work' | 'supply_on_approval' | 'others' | 'liquid_gas'>;
}

export interface DeliveryChallan extends SalesDocument, DeliveryChallanInput {
  line_items?: LineItem[];
  deliverychallan_id: string;
}

// ───────────────────────────── Payments ─────────────────────────────

export interface PaymentApplication {
  invoice_id: string;
  amount_applied: number;
  tax_amount_withheld?: number;
}

export interface CustomerPaymentInput {
  customer_id?: string;
  payment_mode?: LooseString<'cash' | 'check' | 'creditcard' | 'banktransfer' | 'bankremittance' | 'autotransaction' | 'upi' | 'others'>;
  amount?: number;
  date?: ZohoDate;
  reference_number?: string;
  description?: string;
  invoices?: PaymentApplication[];
  exchange_rate?: number;
  bank_charges?: number;
  account_id?: string;
  location_id?: string;
  retainerinvoice_id?: string;
  contact_persons?: string[];
  custom_fields?: CustomFieldValue[];
  tags?: ReportingTag[];
  [key: string]: unknown;
}

export interface CustomerPayment extends CustomerPaymentInput {
  payment_id: string;
  payment_number?: string;
  customer_name?: string;
  unused_amount?: number;
}

export interface Refund {
  refund_id?: string;
  date: ZohoDate;
  refund_mode?: string;
  reference_number?: string;
  amount: number;
  from_account_id?: string;
  description?: string;
  [key: string]: unknown;
}

// ───────────────────────────── Purchases ─────────────────────────────

export interface PurchaseDocumentInput {
  vendor_id?: string;
  currency_id?: string;
  date?: ZohoDate;
  due_date?: ZohoDate;
  reference_number?: string;
  exchange_rate?: number;
  location_id?: string;
  line_items?: LineItemInput[];
  notes?: string;
  terms?: string;
  is_inclusive_tax?: boolean;
  custom_fields?: CustomFieldValue[];
  tags?: ReportingTag[];
  // India GST
  gst_treatment?: GstTreatment;
  gst_no?: string;
  source_of_supply?: string;
  destination_of_supply?: string;
  is_reverse_charge_applied?: boolean;
  // GCC
  tax_treatment?: TaxTreatment;
  [key: string]: unknown;
}

export interface BillInput extends PurchaseDocumentInput {
  bill_number?: string;
  payment_terms?: number;
  purchaseorder_ids?: string[];
}

export interface Bill extends BillInput {
  bill_id: string;
  bill_number: string;
  vendor_name?: string;
  status?: string;
  total?: number;
  balance?: number;
}

export interface PurchaseOrderInput extends PurchaseDocumentInput {
  purchaseorder_number?: string;
  delivery_date?: ZohoDate;
}

export interface PurchaseOrder extends PurchaseOrderInput {
  purchaseorder_id: string;
  purchaseorder_number: string;
  status?: string;
  total?: number;
}

export interface VendorCreditInput extends PurchaseDocumentInput {
  vendor_credit_number?: string;
}

export interface VendorCredit extends VendorCreditInput {
  vendor_credit_id: string;
  status?: string;
  balance?: number;
}

export interface VendorPaymentInput {
  vendor_id?: string;
  bills?: Array<{ bill_id: string; amount_applied: number; tax_amount_withheld?: number }>;
  date?: ZohoDate;
  amount?: number;
  payment_mode?: string;
  paid_through_account_id?: string;
  reference_number?: string;
  description?: string;
  exchange_rate?: number;
  [key: string]: unknown;
}

export interface VendorPayment extends VendorPaymentInput {
  payment_id: string;
  vendor_name?: string;
}

export interface ExpenseInput {
  account_id?: string;
  paid_through_account_id?: string;
  date?: ZohoDate;
  amount?: number;
  tax_id?: string;
  is_inclusive_tax?: boolean;
  is_billable?: boolean;
  customer_id?: string;
  vendor_id?: string;
  project_id?: string;
  currency_id?: string;
  exchange_rate?: number;
  reference_number?: string;
  description?: string;
  line_items?: Array<{ account_id: string; amount: number; tax_id?: string; description?: string; [key: string]: unknown }>;
  // India GST
  gst_no?: string;
  source_of_supply?: string;
  destination_of_supply?: string;
  hsn_or_sac?: string;
  reverse_charge_tax_id?: string;
  custom_fields?: CustomFieldValue[];
  tags?: ReportingTag[];
  [key: string]: unknown;
}

export interface Expense extends ExpenseInput {
  expense_id: string;
  status?: string;
  total?: number;
}

export interface RecurringExpense extends ExpenseInput {
  recurring_expense_id: string;
  recurrence_name?: string;
  start_date?: ZohoDate;
  end_date?: ZohoDate;
  recurrence_frequency?: string;
  repeat_every?: number;
}

export interface RecurringBill extends BillInput {
  recurring_bill_id: string;
  recurrence_name?: string;
  start_date?: ZohoDate;
  end_date?: ZohoDate;
  recurrence_frequency?: string;
  repeat_every?: number;
}

// ───────────────────────────── Accounting & banking ─────────────────────────────

export interface ChartOfAccount {
  account_id: string;
  account_name: string;
  account_code?: string;
  account_type?: string;
  currency_id?: string;
  description?: string;
  is_active?: boolean;
  parent_account_id?: string;
  [key: string]: unknown;
}

export interface JournalLine {
  account_id: string;
  debit_or_credit: 'debit' | 'credit';
  amount: number;
  description?: string;
  customer_id?: string;
  tax_id?: string;
  tags?: ReportingTag[];
  [key: string]: unknown;
}

export interface JournalInput {
  journal_date?: ZohoDate;
  reference_number?: string;
  notes?: string;
  journal_type?: LooseString<'cash' | 'both'>;
  currency_id?: string;
  exchange_rate?: number;
  line_items?: JournalLine[];
  custom_fields?: CustomFieldValue[];
  [key: string]: unknown;
}

export interface Journal extends JournalInput {
  journal_id: string;
  entry_number?: string;
  status?: string;
  total?: number;
}

export interface BankAccount {
  account_id: string;
  account_name: string;
  account_type?: LooseString<'bank' | 'credit_card'>;
  account_number?: string;
  currency_id?: string;
  balance?: number;
  bank_name?: string;
  routing_number?: string;
  is_active?: boolean;
  [key: string]: unknown;
}

export interface BankTransaction {
  transaction_id: string;
  date: ZohoDate;
  amount: number;
  transaction_type?: string;
  status?: string;
  reference_number?: string;
  description?: string;
  from_account_id?: string;
  to_account_id?: string;
  [key: string]: unknown;
}

// ───────────────────────────── Projects, users, misc ─────────────────────────────

export interface Project {
  project_id: string;
  project_name: string;
  customer_id?: string;
  billing_type?: LooseString<'fixed_cost_for_project' | 'based_on_project_hours' | 'based_on_staff_hours' | 'based_on_task_hours'>;
  rate?: number;
  status?: string;
  description?: string;
  [key: string]: unknown;
}

export interface ProjectTask {
  task_id: string;
  task_name: string;
  project_id?: string;
  rate?: number;
  [key: string]: unknown;
}

export interface TimeEntry {
  time_entry_id: string;
  project_id: string;
  task_id?: string;
  user_id?: string;
  log_date: ZohoDate;
  log_time?: string;
  begin_time?: string;
  end_time?: string;
  is_billable?: boolean;
  notes?: string;
  [key: string]: unknown;
}

export interface User {
  user_id: string;
  name: string;
  email: string;
  user_role?: string;
  status?: string;
  [key: string]: unknown;
}

export interface Location {
  location_id: string;
  location_name: string;
  type?: string;
  is_primary?: boolean;
  address?: Address;
  /** India: a location can carry its own GSTIN. */
  tax_settings_id?: string;
  [key: string]: unknown;
}

// ───────────────────────────── E-invoicing ─────────────────────────────

/** India IRP / UAE e-invoice status attached to invoices and credit notes. */
export interface EInvoiceDetails {
  /** Invoice Reference Number (64-char hash) issued by the IRP. */
  inv_ref_num?: string;
  irn?: string;
  ack_number?: string;
  ack_no?: string;
  ack_date?: string;
  status?: LooseString<'pushed' | 'cancelled' | 'failed' | 'yet_to_be_pushed' | 'marked_as_pushed' | 'marked_as_cancelled'>;
  formatted_status?: string;
  signed_qr_code?: string;
  [key: string]: unknown;
}

export interface MarkEInvoicePushedInput {
  /** IRN. */
  uuid: string;
  ack_no: string;
  ack_date: string;
  signed_qr_code?: string;
  internal_data?: string;
  [key: string]: unknown;
}

export interface EInvoiceCancelInput {
  /**
   * IRP cancellation reason. NIC codes: 1 = Duplicate, 2 = Data entry mistake,
   * 3 = Order cancelled, 4 = Others. Passed through as-is.
   */
  reason?: string;
  cancel_reason?: string;
  remarks?: string;
  [key: string]: unknown;
}
