/**
 * The figures on an invoice, from the bookings it covers.
 *
 * Every booking already carries a frozen, VAT-inclusive price. An invoice adds them up —
 * one line per booking — and applies the one decision that belongs to the invoice itself:
 * whether VAT is charged. The client: "some customers (even companies) might not want to pay
 * the VAT", so a VAT-exempt invoice takes the tax out of each line rather than repricing
 * anything. Supplier earnings and commission are untouched: VAT was never theirs.
 *
 * Pure, so a combined invoice can be checked to the cent without a database.
 */

export interface BookingFigures {
  bookingId: string;
  description: string;
  currency: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  taxMinor: number;
  taxRateBps: number;
  securityDepositMinor: number;
  /** VAT-inclusive total of goods and services, excluding the deposit. */
  totalMinor: number;
}

export interface InvoiceLineFigures {
  bookingId: string;
  description: string;
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  taxMinor: number;
  securityDepositMinor: number;
  totalMinor: number;
  sortOrder: number;
}

export interface InvoiceFigures {
  currency: string;
  lines: InvoiceLineFigures[];
  subtotalMinor: number;
  deliveryFeeMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  taxMinor: number;
  taxRateBps: number;
  securityDepositMinor: number;
  /** Goods and services, as charged. */
  totalMinor: number;
  /** What the customer transfers: the total plus the refundable deposits. */
  amountDueMinor: number;
}

export class InvoiceMathError extends Error {}

export function buildInvoice(bookings: BookingFigures[], vatExempt: boolean): InvoiceFigures {
  if (bookings.length === 0) throw new InvoiceMathError('An invoice needs at least one booking');
  const currency = bookings[0].currency;
  if (bookings.some((b) => b.currency !== currency)) {
    throw new InvoiceMathError('Bookings in different currencies cannot share an invoice');
  }

  const lines = bookings.map((b, index) => {
    // The line's prices already contain VAT. Exempting it takes the VAT out of the total;
    // the net components (rental, delivery, fees) are what they were.
    const tax = vatExempt ? 0 : b.taxMinor;
    return {
      bookingId: b.bookingId,
      description: b.description,
      subtotalMinor: b.subtotalMinor,
      deliveryFeeMinor: b.deliveryFeeMinor,
      serviceFeeMinor: b.serviceFeeMinor,
      discountMinor: b.discountMinor,
      taxMinor: tax,
      securityDepositMinor: b.securityDepositMinor,
      totalMinor: vatExempt ? b.totalMinor - b.taxMinor : b.totalMinor,
      sortOrder: index,
    };
  });

  const sum = (pick: (l: InvoiceLineFigures) => number) =>
    lines.reduce((acc, l) => acc + pick(l), 0);
  const totalMinor = sum((l) => l.totalMinor);
  const securityDepositMinor = sum((l) => l.securityDepositMinor);

  // One rate per invoice. Every booking is priced at the platform rate, so they agree; if
  // they ever do not, report the highest rather than inventing a blend.
  const taxRateBps = vatExempt ? 0 : Math.max(...bookings.map((b) => b.taxRateBps));

  return {
    currency,
    lines,
    subtotalMinor: sum((l) => l.subtotalMinor),
    deliveryFeeMinor: sum((l) => l.deliveryFeeMinor),
    serviceFeeMinor: sum((l) => l.serviceFeeMinor),
    discountMinor: sum((l) => l.discountMinor),
    taxMinor: sum((l) => l.taxMinor),
    taxRateBps,
    securityDepositMinor,
    totalMinor,
    amountDueMinor: totalMinor + securityDepositMinor,
  };
}

/**
 * Splits one declared transfer across the bookings of a combined invoice, in proportion to
 * what each owes, with any rounding remainder on the last line so the parts always add up
 * to exactly what the customer said they sent.
 */
export function allocatePayment(amountMinor: number, dues: number[]): number[] {
  const total = dues.reduce((a, b) => a + b, 0);
  if (dues.length === 0) return [];
  if (total <= 0) return dues.map((_, i) => (i === dues.length - 1 ? amountMinor : 0));
  const parts = dues.map((due) => Math.floor((amountMinor * due) / total));
  const allocated = parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] += amountMinor - allocated;
  return parts;
}
