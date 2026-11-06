/** Record payments from your own system against unpaid Zoho invoices, page by page. */
import { ZohoBooks, toZohoDate } from '@ansh-devs/zoho-books-sdk';

const books = ZohoBooks.fromEnv();
const paidInMySystem = new Map<string, number>([['ORDER-1042', 43660]]);

for await (const inv of books.invoices.iterate({ status: 'unpaid' })) {
  const amount = inv.reference_number ? paidInMySystem.get(inv.reference_number) : undefined;
  if (!amount) continue;
  await books.customerPayments.create({
    customer_id: inv.customer_id!,
    payment_mode: 'banktransfer',
    amount,
    date: toZohoDate(new Date()),
    reference_number: inv.reference_number,
    invoices: [{ invoice_id: inv.invoice_id, amount_applied: amount }],
  });
  console.log(`Recorded ₹${amount} against ${inv.invoice_number}`);
}
