import PDFDocument from 'pdfkit';

export interface SettlementPdfInput {
  reference: string;
  vendorName: string;
  productName: string;
  rentalDates: string;
  rows: { label: string; value: string; emphasis?: boolean }[];
  status: string;
  paidAt: string | null;
  payoutReference: string | null;
  generatedAt: Date;
}

const MARGIN = 56;
const INK = '#1a2e44';
const MUTED = '#6b7a8d';
const RULE = '#d8dee6';

/**
 * The Settlement Record under Documents & Records: what the vendor was paid for one
 * booking and why. Rendered on demand from the settlement row, so it always matches it.
 */
export async function renderSettlementPdf(input: SettlementPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: `Settlement Record — ${input.reference}`, Author: 'Eskista Marketplace PLC' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - MARGIN * 2;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text('Settlement Record');
  doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(`Booking ${input.reference}`);
  doc.moveDown(1);

  const meta: [string, string][] = [
    ['Vendor', input.vendorName],
    ['Equipment', input.productName],
    ['Rental dates', input.rentalDates],
    ['Status', input.status],
    ['Paid on', input.paidAt ?? '—'],
    ['Payout reference', input.payoutReference ?? '—'],
  ];
  for (const [label, value] of meta) row(doc, label, value, width, false);

  doc.moveDown(0.6);
  doc
    .save()
    .strokeColor(RULE)
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + width, doc.y)
    .stroke()
    .restore();
  doc.moveDown(0.8);

  for (const r of input.rows) row(doc, r.label, r.value, width, r.emphasis ?? false);

  doc.moveDown(2);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      'Eskista collects payment from the client and pays the vendor their listed price in ' +
        'full. Eskista’s commission and VAT are charged to the client on top. Generated ' +
        `${input.generatedAt.toISOString().slice(0, 10)}.`,
      { width },
    );

  doc.end();
  return finished;
}

function row(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  width: number,
  emphasis: boolean,
): void {
  const y = doc.y;
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, MARGIN, y);
  doc
    .fillColor(INK)
    .font(emphasis ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(emphasis ? 11 : 10)
    .text(value, MARGIN, y, { width, align: 'right' });
  doc.moveDown(0.45);
}
