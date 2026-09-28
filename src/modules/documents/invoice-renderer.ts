import PDFDocument from 'pdfkit';

export interface InvoicePdfLine {
  reference: string;
  description: string;
  rentalMinor: number;
  deliveryMinor: number;
  serviceFeeMinor: number;
  discountMinor: number;
  totalMinor: number;
}

export interface InvoicePdfInput {
  number: string;
  status: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  company: {
    legalName: string;
    tin: string | null;
    vatNumber: string | null;
    address: string;
    phone: string;
    email: string | null;
  };
  billedTo: { name: string; phone: string | null; address: string | null; tin: string | null };
  lines: InvoicePdfLine[];
  currency: string;
  totalMinor: number;
  taxMinor: number;
  taxRateBps: number;
  vatExempt: boolean;
  vatExemptionReason: string | null;
  securityDepositMinor: number;
  amountDueMinor: number;
  amountPaidMinor: number;
  paymentInstructions: string[];
}

const MARGIN = 48;
const INK = '#1a2e44';
const MUTED = '#6b7a8d';
const RULE = '#d8dee6';
const ACCENT = '#1f7a3a';

const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const day = (d: Date | null) =>
  d
    ? d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';

/**
 * The invoice as a PDF: Eskista's details, who is billed, one line per booking, VAT shown as
 * *included* (prices are VAT-inclusive) or the exemption, the refundable deposit apart from
 * the total, and how to pay.
 *
 * Rendered on demand from the invoice's frozen figures and billing snapshot, so a reprint
 * months later matches what was issued.
 */
export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: `Invoice ${input.number}`, Author: input.company.legalName },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - MARGIN * 2;
  const m = (minor: number) => money(minor, input.currency);

  // ── Header: Eskista on the left, invoice meta on the right ──
  const top = doc.y;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(input.company.legalName, MARGIN, top);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9);
  for (const line of [
    input.company.address,
    input.company.phone,
    input.company.email,
    input.company.tin ? `TIN ${input.company.tin}` : null,
    input.company.vatNumber ? `VAT Reg. ${input.company.vatNumber}` : null,
  ]) {
    if (line) doc.text(line, { width: width / 2 });
  }
  const leftBottom = doc.y;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text('INVOICE', MARGIN, top, {
    width,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(10).fillColor(MUTED);
  for (const [label, value] of [
    ['Number', input.number],
    ['Issued', day(input.issuedAt)],
    ['Due', day(input.dueAt)],
    ['Status', input.status],
  ] as const) {
    doc.text(`${label}: ${value}`, MARGIN, doc.y, { width, align: 'right' });
  }
  doc.y = Math.max(leftBottom, doc.y) + 16;

  // ── Billed to ──
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('BILLED TO', MARGIN);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(input.billedTo.name);
  doc.font('Helvetica').fontSize(9.5).fillColor(INK);
  for (const line of [
    input.billedTo.address,
    input.billedTo.phone,
    input.billedTo.tin ? `TIN ${input.billedTo.tin}` : null,
  ]) {
    if (line) doc.text(line);
  }
  doc.moveDown(1);

  // ── Lines ──
  const cols = { ref: MARGIN, desc: MARGIN + 88, amount: MARGIN + width - 110 };
  const header = doc.y;
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9);
  doc.text('BOOKING', cols.ref, header);
  doc.text('DESCRIPTION', cols.desc, header);
  doc.text('AMOUNT', cols.amount, header, { width: 110, align: 'right' });
  rule(doc, width);

  for (const line of input.lines) {
    if (doc.y > doc.page.height - 200) doc.addPage();
    const y = doc.y + 4;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9.5).text(line.reference, cols.ref, y);
    doc
      .font('Helvetica')
      .text(line.description, cols.desc, y, { width: cols.amount - cols.desc - 12 });
    const parts = [
      ['Rental', line.rentalMinor],
      ['Delivery', line.deliveryMinor],
      ['Service fee', line.serviceFeeMinor],
      ['Discount', -line.discountMinor],
    ].filter(([, v]) => v !== 0) as [string, number][];
    doc.fillColor(MUTED).fontSize(8.5);
    for (const [label, value] of parts) {
      doc.text(`${label} ${m(value)}`, cols.desc, doc.y, { width: cols.amount - cols.desc - 12 });
    }
    // The amount is drawn back at the row's top, which moves the cursor up; remember how far
    // the description and its breakdown reached so the divider goes below them.
    const rowBottom = doc.y;
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(m(line.totalMinor), cols.amount, y, {
        width: 110,
        align: 'right',
      });
    doc.y = Math.max(rowBottom, y + 14) + 2;
    rule(doc, width);
  }

  // ── Totals ──
  doc.moveDown(0.4);
  const total = (label: string, value: string, strong = false, colour = INK) => {
    const y = doc.y;
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9.5)
      .text(label, MARGIN + width / 2, y, {
        width: width / 2 - 120,
      });
    doc
      .fillColor(colour)
      .font(strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(strong ? 11 : 9.5)
      .text(value, cols.amount, y, { width: 110, align: 'right' });
    doc.moveDown(0.3);
  };
  total('Total (goods & services)', m(input.totalMinor), true);
  if (input.vatExempt) {
    total('VAT', `Exempt${input.vatExemptionReason ? ` — ${input.vatExemptionReason}` : ''}`);
  } else {
    total(`VAT included (${(input.taxRateBps / 100).toFixed(0)}%)`, m(input.taxMinor));
  }
  if (input.securityDepositMinor > 0) {
    total('Security deposit (refundable)', m(input.securityDepositMinor));
  }
  total('Amount due', m(input.amountDueMinor), true);
  if (input.amountPaidMinor > 0) {
    total('Paid', m(input.amountPaidMinor), false, ACCENT);
    total('Balance', m(Math.max(input.amountDueMinor - input.amountPaidMinor, 0)), true);
  }

  // ── How to pay ──
  if (input.paymentInstructions.length > 0) {
    doc.moveDown(1);
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text('HOW TO PAY', MARGIN);
    doc.fillColor(INK).font('Helvetica').fontSize(9.5);
    for (const line of input.paymentInstructions) doc.text(line, MARGIN, doc.y, { width });
    doc.text(`Use ${input.number} as the payment reference.`, MARGIN, doc.y, { width });
  }

  doc.moveDown(1.5);
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .text(
      'Prices include VAT unless the invoice is marked exempt. The security deposit is ' +
        'refunded after the equipment is returned and inspected. Eskista collects payment ' +
        'and pays each supplier.',
      MARGIN,
      doc.y,
      { width },
    );

  doc.end();
  return finished;
}

function rule(doc: PDFKit.PDFDocument, width: number): void {
  doc.moveDown(0.3);
  doc
    .save()
    .strokeColor(RULE)
    .lineWidth(0.7)
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + width, doc.y)
    .stroke()
    .restore();
  doc.moveDown(0.3);
}
