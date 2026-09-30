import PDFDocument from 'pdfkit';

export interface InspectionPdfInput {
  /** "Outgoing Inspection Sheet", "Return Inspection Sheet", "Routine Inspection". */
  title: string;
  bookingReference: string | null;
  equipment: string;
  unit: string | null;
  serialNumber: string | null;
  rows: { label: string; value: string }[];
  notes: string | null;
  inspector: string;
  inspectedAt: Date;
  generatedAt: Date;
}

const MARGIN = 56;
const INK = '#1a2e44';
const MUTED = '#6b7a8d';
const RULE = '#d8dee6';

/**
 * An inspection as a one-page sheet — the "outgoing inspection sheet" under a booking's
 * Documents, and the same for the return. Rendered from the inspection row on demand.
 */
export async function renderInspectionPdf(input: InspectionPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: input.title, Author: 'Eskista Marketplace PLC' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - MARGIN * 2;

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(input.title);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(11)
    .text(input.bookingReference ? `Booking ${input.bookingReference}` : 'Routine check');
  doc.moveDown(1);

  const meta: [string, string][] = [
    ['Equipment', input.equipment],
    ['Unit', input.unit ?? '—'],
    ['Serial number', input.serialNumber ?? '—'],
    ['Inspector', input.inspector],
    ['Inspected', input.inspectedAt.toISOString().replace('T', ' ').slice(0, 16)],
  ];
  for (const [label, value] of meta) row(doc, label, value, width);

  rule(doc, width);
  for (const r of input.rows) row(doc, r.label, r.value, width);

  if (input.notes) {
    rule(doc, width);
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Observations', MARGIN);
    doc.moveDown(0.3);
    doc.fillColor(INK).fontSize(10).text(input.notes, MARGIN, doc.y, { width });
  }

  doc.moveDown(2);
  doc
    .fillColor(MUTED)
    .fontSize(8.5)
    .text(
      'Recorded by Eskista staff at the hub. Condition photos are kept with the booking. ' +
        `Generated ${input.generatedAt.toISOString().slice(0, 10)}.`,
      MARGIN,
      doc.y,
      { width },
    );

  doc.end();
  return finished;
}

function rule(doc: PDFKit.PDFDocument, width: number): void {
  doc.moveDown(0.6);
  doc
    .save()
    .strokeColor(RULE)
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + width, doc.y)
    .stroke()
    .restore();
  doc.moveDown(0.8);
}

function row(doc: PDFKit.PDFDocument, label: string, value: string, width: number): void {
  const y = doc.y;
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(label, MARGIN, y);
  doc
    .fillColor(INK)
    .font('Helvetica')
    .fontSize(10)
    .text(value, MARGIN, y, { width, align: 'right' });
  doc.moveDown(0.45);
}
