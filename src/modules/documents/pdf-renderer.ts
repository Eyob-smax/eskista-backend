import PDFDocument from 'pdfkit';

export interface PdfMetaRow {
  label: string;
  value: string;
}

export interface RenderAgreementPdfInput {
  /** "Equipment Rental Agreement". */
  title: string;
  /** The booking or agreement reference, printed under the title. */
  reference: string;
  /** Ref / Rental dates / Date / Governed by — the header block on the design. */
  meta: PdfMetaRow[];
  /** The frozen agreement text, in the light Markdown the templates use. */
  body: string;
  /**
   * SHA-256 of the frozen body, printed in the footer.
   *
   * Without it a printed contract is just paper: the hash is what lets anyone check the
   * page they are holding against the bytes the parties actually agreed to.
   */
  contentHash: string | null;
  signerName: string | null;
  signedAt: Date | null;
}

const MARGIN = 56;
const INK = '#1a2e44';
const MUTED = '#6b7a8d';
const RULE = '#d8dee6';

/**
 * Renders an agreement to PDF, for the **Download Agreement** button.
 *
 * `pdfkit` rather than a headless browser: these documents are text, a rule and a
 * signature block, and shipping Chromium to render them would dwarf the entire API.
 *
 * The renderer consumes the **frozen body** rather than re-rendering from a template, so
 * the PDF always matches the hash that was issued (AD-5). Re-rendering from the template
 * would silently produce a different document the day anyone edits it.
 *
 * The Markdown handled here is only what the agreement templates actually use — `#`
 * headings, `**bold**` runs, `-` bullets and numbered clauses. A general Markdown engine
 * would be a dependency and a rendering surface for no benefit.
 */
export async function renderAgreementPdf(input: RenderAgreementPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: {
      Title: `${input.title} — ${input.reference}`,
      Author: 'Eskista Marketplace PLC',
      Subject: input.reference,
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - MARGIN * 2;

  // ── Header ──
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(input.title);
  doc.moveDown(0.2);
  doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(`Reference — ${input.reference}`);
  doc.moveDown(0.8);

  for (const row of input.meta) {
    const y = doc.y;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(row.label, MARGIN, y);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(row.value, MARGIN, y, { width, align: 'right' });
    doc.moveDown(0.35);
  }

  doc.moveDown(0.4);
  rule(doc, width);
  doc.moveDown(0.8);

  // ── Body ──
  renderBody(doc, input.body, width);

  // ── Signature block ──
  doc.moveDown(1.2);
  if (doc.y > doc.page.height - 190) doc.addPage();
  rule(doc, width);
  doc.moveDown(0.8);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Signatures');
  doc.moveDown(0.6);

  const columnWidth = (width - 32) / 2;
  const top = doc.y;

  signatureColumn(doc, MARGIN, top, columnWidth, 'For Eskista', 'Eskista Marketplace PLC', null);
  signatureColumn(
    doc,
    MARGIN + columnWidth + 32,
    top,
    columnWidth,
    'Counterparty',
    input.signerName ?? '',
    input.signedAt,
  );

  doc.y = top + 96;

  // ── Footer ──
  doc.moveDown(1);
  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(8)
    .text(
      input.contentHash
        ? `Document integrity: ${input.contentHash}`
        : 'Document integrity: not recorded',
      MARGIN,
      doc.y,
      { width },
    );
  doc.text(
    'Print this document, sign it by hand, and upload the scanned copy in the Eskista app.',
    { width },
  );

  doc.end();
  return finished;
}

function rule(doc: PDFKit.PDFDocument, width: number): void {
  doc
    .strokeColor(RULE)
    .lineWidth(0.8)
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + width, doc.y)
    .stroke();
}

function signatureColumn(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  role: string,
  name: string,
  signedAt: Date | null,
): void {
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(role, x, y, { width });

  // The line people actually sign on.
  const lineY = y + 46;
  doc
    .strokeColor(RULE)
    .lineWidth(0.8)
    .moveTo(x, lineY)
    .lineTo(x + width, lineY)
    .stroke();

  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(name || ' ', x, lineY + 6, { width });

  doc
    .fillColor(MUTED)
    .font('Helvetica')
    .fontSize(9)
    .text(
      signedAt ? `Signed ${signedAt.toISOString().slice(0, 10)}` : 'Date: ________________',
      x,
      lineY + 22,
      { width },
    );
}

/**
 * Renders the subset of Markdown the agreement templates use.
 *
 * Unrecognised syntax falls through as plain text rather than being dropped — a clause
 * silently missing from a contract is far worse than one that renders with stray asterisks.
 */
function renderBody(doc: PDFKit.PDFDocument, body: string, width: number): void {
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd();

    if (line.trim() === '') {
      doc.moveDown(0.5);
      continue;
    }

    if (doc.y > doc.page.height - MARGIN - 40) doc.addPage();

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      doc.moveDown(0.5);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(level === 1 ? 14 : level === 2 ? 12 : 11)
        .text(stripEmphasis(heading[2] ?? ''), { width });
      doc.moveDown(0.25);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      doc
        .fillColor(INK)
        .font('Helvetica')
        .fontSize(10)
        .text(`•  ${stripEmphasis(bullet[1] ?? '')}`, { width, indent: 10 });
      continue;
    }

    // A line that is entirely bold is a clause heading in these templates.
    const wholeLineBold = /^\*\*(.+)\*\*$/.exec(line.trim());
    if (wholeLineBold) {
      doc.moveDown(0.3);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .text(stripEmphasis(wholeLineBold[1] ?? ''), { width });
      continue;
    }

    doc.fillColor(INK).font('Helvetica').fontSize(10).text(stripEmphasis(line), {
      width,
      align: 'left',
    });
  }
}

/** Removes `**` and `__` markers, leaving the words. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
}
