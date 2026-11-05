/**
 * Create a GST-compliant invoice, push it to the IRP and download the PDF.
 *
 *   ZOHO_CLIENT_ID=... ZOHO_CLIENT_SECRET=... ZOHO_REFRESH_TOKEN=... \
 *   ZOHO_ORGANIZATION_ID=... ZOHO_DATA_CENTER=in CUSTOMER_ID=... \
 *   node --experimental-strip-types examples/gst-invoice.ts
 */
import { writeFile } from 'node:fs/promises';
import { ZohoBooks, ZohoGstError, ZohoRateLimitError } from 'zoho-books-sdk';

const books = ZohoBooks.fromEnv({ gst: { requireHsn: true, validateHsn: { minDigits: 6 } } });

try {
  const prepared = await books.gst.prepareInvoice({
    customer_id: process.env.CUSTOMER_ID!,
    reference_number: 'ORDER-1042',
    line_items: [
      { name: 'Consulting', quantity: 10, rate: 2500, gstRate: 18, hsn_or_sac: '998314' },
      { name: 'Hardware', quantity: 1, rate: 15000, gstRate: 18, hsn_or_sac: '847130' },
    ],
  });
  console.log(`Supply: ${prepared.supplyType}, place of supply: ${prepared.placeOfSupply}`);

  const invoice = await books.invoices.create(prepared.payload);
  console.log(`Created ${invoice.invoice_number} (total ₹${invoice.total})`);

  await books.invoices.einvoice.push(invoice.invoice_id);
  const einvoice = await books.invoices.einvoice.get(invoice.invoice_id);
  console.log('IRN:', einvoice.inv_ref_num ?? einvoice.irn);

  const pdf = await books.invoices.pdf(invoice.invoice_id);
  await writeFile(pdf.filename ?? `${invoice.invoice_number}.pdf`, pdf.data);
} catch (err) {
  if (err instanceof ZohoGstError) console.error(`GST validation failed on ${err.field}: ${err.message}`);
  else if (err instanceof ZohoRateLimitError) console.error(`Rate limited (${err.kind}); try later`);
  else throw err;
}
