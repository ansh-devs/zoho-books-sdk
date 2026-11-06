/** A string union that still accepts values Zoho adds later. */
export type LooseString<T extends string> = T | (string & {});

/** ISO 8601 calendar date, the format of every Zoho date field. */
export type ZohoDate = string;

export interface Address {
  attention?: string;
  address?: string;
  street2?: string;
  city?: string;
  state?: string;
  state_code?: string;
  zip?: string;
  country?: string;
  fax?: string;
  phone?: string;
}

export interface CustomFieldValue {
  customfield_id?: string;
  /** Contacts use index 1 to 10 instead of customfield_id. */
  index?: number;
  label?: string;
  api_name?: string;
  value: string | number | boolean | null;
}

export interface ReportingTag {
  tag_id: string;
  tag_option_id: string;
}

export interface ContactPersonRef {
  contact_person_id: string;
  communication_preference?: {
    is_email_enabled?: boolean;
    is_sms_enabled?: boolean;
    is_whatsapp_enabled?: boolean;
  };
}

/** India GST treatment. Zoho documents business_gst, business_none, overseas and consumer. */
export type GstTreatment = LooseString<
  | 'business_gst'
  | 'business_none'
  | 'overseas'
  | 'consumer'
  | 'business_sez'
  | 'deemed_export'
  | 'tax_deductor'
  | 'tax_collector'
  | 'business_registered_composition'
>;

/** GCC and UAE tax treatment. */
export type TaxTreatment = LooseString<
  | 'vat_registered'
  | 'vat_not_registered'
  | 'gcc_vat_not_registered'
  | 'gcc_vat_registered'
  | 'non_gcc'
  | 'dz_vat_registered'
  | 'dz_vat_not_registered'
>;

export type ProductType = LooseString<'goods' | 'services' | 'digital_service' | 'capital_service' | 'capital_goods'>;

export interface LineItemInput {
  line_item_id?: string;
  item_id?: string;
  name?: string;
  description?: string;
  item_order?: number;
  rate?: number;
  bcy_rate?: number;
  quantity?: number;
  unit?: string;
  /** Percentage string such as "10%" or a flat amount. */
  discount?: number | string;
  discount_amount?: number;
  tax_id?: string;
  tds_tax_id?: string;
  tax_exemption_id?: string;
  tax_exemption_code?: string;
  reverse_charge_tax_id?: string;
  /** India HSN code for goods or SAC code for services. A string so leading zeros survive. */
  hsn_or_sac?: string;
  product_type?: ProductType;
  location_id?: string;
  project_id?: string;
  time_entry_ids?: string[];
  expense_id?: string;
  salesorder_item_id?: string;
  account_id?: string;
  tags?: ReportingTag[];
  item_custom_fields?: CustomFieldValue[];
  line_item_category?: LooseString<'line_item' | 'header' | 'subtotal'>;
}

export interface LineItem extends LineItemInput {
  line_item_id: string;
  item_total?: number;
  tax_name?: string;
  tax_type?: string;
  tax_percentage?: number;
  line_item_taxes?: Array<{ tax_id: string; tax_name: string; tax_amount: number }>;
  [key: string]: unknown;
}

export interface TaxSummary {
  tax_id?: string;
  tax_name: string;
  tax_amount: number;
  tax_specification?: string;
  [key: string]: unknown;
}

/** Header fields shared by invoices, estimates, sales orders and credit notes. */
export interface SalesDocumentInput {
  customer_id?: string;
  currency_id?: string;
  contact_persons?: string[];
  contact_persons_associated?: ContactPersonRef[];
  date?: ZohoDate;
  reference_number?: string;
  template_id?: string;
  exchange_rate?: number;
  location_id?: string;
  salesperson_id?: string;
  salesperson_name?: string;
  line_items?: LineItemInput[];
  discount?: number | string;
  is_discount_before_tax?: boolean;
  discount_type?: LooseString<'entity_level' | 'item_level'>;
  is_inclusive_tax?: boolean;
  notes?: string;
  terms?: string;
  shipping_charge?: number | string;
  adjustment?: number;
  adjustment_description?: string;
  custom_fields?: CustomFieldValue[];
  tags?: ReportingTag[];
  billing_address_id?: string;
  shipping_address_id?: string;
  gst_treatment?: GstTreatment;
  gst_no?: string;
  /** India: two letter state code such as KA. GCC: emirate or country code. */
  place_of_supply?: string;
  is_reverse_charge_applied?: boolean;
  shipping_gst_no?: string;
  shipping_trader_name?: string;
  shipping_legal_name?: string;
  tax_treatment?: TaxTreatment;
  vat_treatment?: string;
  tax_reg_no?: string;
  tax_id?: string;
  tax_authority_id?: string;
  tax_exemption_id?: string;
}

export interface SalesDocument extends SalesDocumentInput {
  customer_name?: string;
  currency_code?: string;
  status?: string;
  sub_total?: number;
  tax_total?: number;
  total?: number;
  taxes?: TaxSummary[];
  billing_address?: Address;
  shipping_address?: Address;
  created_time?: string;
  last_modified_time?: string;
  line_items?: LineItem[];
  [key: string]: unknown;
}

export interface Comment {
  comment_id: string;
  description: string;
  commented_by?: string;
  date?: string;
  [key: string]: unknown;
}

export interface EmailInput {
  send_from_org_email_id?: boolean;
  from_address_id?: string;
  to_mail_ids: string[];
  cc_mail_ids?: string[];
  bcc_mail_ids?: string[];
  subject?: string;
  body?: string;
}

/** Filters most list endpoints accept. Custom field filters use the cf_ prefix. */
export interface CommonListParams {
  page?: number;
  per_page?: number;
  sort_column?: string;
  sort_order?: 'A' | 'D';
  search_text?: string;
  filter_by?: string;
  customer_id?: string;
  date_start?: ZohoDate;
  date_end?: ZohoDate;
  last_modified_time?: string;
  [customField: `cf_${string}`]: string | number | boolean | undefined;
}
