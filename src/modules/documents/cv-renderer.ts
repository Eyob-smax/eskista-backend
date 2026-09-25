import PDFDocument from 'pdfkit';
import type { CvDocument, CvEntry } from '../talent/talent-cv';

const MARGIN = 48;
const INK = '#1a2e44';
const MUTED = '#6b7a8d';
const ACCENT = '#c8553d';
const RULE = '#d8dee6';
const SIDEBAR_BG = '#f1f4f7';

/**
 * Renders the auto-generated CV to PDF, for **My CV → Download**.
 *
 * Three layouts, matching the template picker: CLASSIC (single column, centred header),
 * MINIMAL (single column, left-aligned, no rules) and SIDEBAR (skills and languages in a
 * shaded left column). The content is identical in all three; only the layout moves.
 *
 * Images are not embedded: the avatar lives behind the authenticated file endpoint, and a
 * CV that fails to render because a photo could not be fetched is worse than one without.
 */
export async function renderCvPdf(cv: CvDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    info: { Title: `${cv.name} — CV`, Author: cv.name, Creator: 'Eskista' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (cv.template === 'SIDEBAR') sidebarLayout(doc, cv);
  else singleColumn(doc, cv, cv.template === 'CLASSIC');

  doc.end();
  return finished;
}

function singleColumn(doc: PDFKit.PDFDocument, cv: CvDocument, classic: boolean): void {
  const width = doc.page.width - MARGIN * 2;
  const align = classic ? 'center' : 'left';

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(22).text(cv.name, { width, align });
  if (cv.headline) {
    doc.fillColor(ACCENT).font('Helvetica').fontSize(12).text(cv.headline, { width, align });
  }
  const contact = [cv.location, cv.email, cv.phone, cv.profileUrl].filter(Boolean).join('  ·  ');
  doc.moveDown(0.3);
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(contact, { width, align });
  doc.moveDown(0.6);
  if (classic) rule(doc, MARGIN, width);

  if (cv.bio) section(doc, 'Profile', MARGIN, width, classic, () => paragraph(doc, cv.bio!, width));
  entries(doc, 'Experience', cv.experience, MARGIN, width, classic);
  entries(doc, 'Portfolio', cv.portfolio, MARGIN, width, classic);
  entries(doc, 'Education', cv.education, MARGIN, width, classic);
  if (cv.skills.length > 0) {
    section(doc, 'Skills', MARGIN, width, classic, () =>
      paragraph(doc, cv.skills.join('  ·  '), width),
    );
  }
  if (cv.languages.length > 0) {
    section(doc, 'Languages', MARGIN, width, classic, () =>
      paragraph(doc, cv.languages.join('  ·  '), width),
    );
  }
}

function sidebarLayout(doc: PDFKit.PDFDocument, cv: CvDocument): void {
  const sideWidth = 170;
  const gap = 24;
  const mainX = MARGIN + sideWidth + gap;
  const mainWidth = doc.page.width - mainX - MARGIN;

  doc
    .save()
    .rect(0, 0, MARGIN + sideWidth + gap / 2, doc.page.height)
    .fill(SIDEBAR_BG)
    .restore();

  // Sidebar
  let y = MARGIN;
  doc
    .fillColor(INK)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(cv.name, MARGIN, y, { width: sideWidth });
  if (cv.headline) {
    doc.fillColor(ACCENT).font('Helvetica').fontSize(10).text(cv.headline, { width: sideWidth });
  }
  doc.moveDown(0.8);
  for (const line of [cv.location, cv.email, cv.phone, cv.profileUrl].filter(Boolean) as string[]) {
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(line, { width: sideWidth });
  }
  const sideList = (title: string, items: string[]) => {
    if (items.length === 0) return;
    doc.moveDown(1);
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(title.toUpperCase(), { width: sideWidth });
    doc.moveDown(0.3);
    for (const item of items) {
      doc.fillColor(INK).font('Helvetica').fontSize(9).text(item, { width: sideWidth });
    }
  };
  sideList('Professions', cv.professions);
  sideList('Skills', cv.skills);
  sideList('Languages', cv.languages);

  // Main column
  y = MARGIN;
  doc.y = y;
  if (cv.bio) {
    section(doc, 'Profile', mainX, mainWidth, false, () =>
      paragraph(doc, cv.bio!, mainWidth, mainX),
    );
  }
  entries(doc, 'Experience', cv.experience, mainX, mainWidth, false);
  entries(doc, 'Portfolio', cv.portfolio, mainX, mainWidth, false);
  entries(doc, 'Education', cv.education, mainX, mainWidth, false);
}

function section(
  doc: PDFKit.PDFDocument,
  title: string,
  x: number,
  width: number,
  ruled: boolean,
  body: () => void,
): void {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.8);
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(11).text(title.toUpperCase(), x, doc.y, {
    width,
    characterSpacing: 0.5,
  });
  if (ruled) rule(doc, x, width);
  doc.moveDown(0.3);
  body();
}

function entries(
  doc: PDFKit.PDFDocument,
  title: string,
  items: CvEntry[],
  x: number,
  width: number,
  ruled: boolean,
): void {
  if (items.length === 0) return;
  section(doc, title, x, width, ruled, () => {
    for (const item of items) {
      if (doc.y > doc.page.height - 90) doc.addPage();
      const top = doc.y;
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .text(item.title, x, top, {
          width: width - 110,
        });
      if (item.period) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(item.period, x, top, {
          width,
          align: 'right',
        });
      }
      if (item.subtitle) {
        doc
          .fillColor(MUTED)
          .font('Helvetica')
          .fontSize(9.5)
          .text(item.subtitle, x, doc.y, { width });
      }
      if (item.description) paragraph(doc, item.description, width, x);
      doc.moveDown(0.5);
    }
  });
}

function paragraph(doc: PDFKit.PDFDocument, text: string, width: number, x = MARGIN): void {
  doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(text, x, doc.y, { width, lineGap: 2 });
}

function rule(doc: PDFKit.PDFDocument, x: number, width: number): void {
  doc.moveDown(0.2);
  doc
    .save()
    .strokeColor(RULE)
    .lineWidth(0.8)
    .moveTo(x, doc.y)
    .lineTo(x + width, doc.y)
    .stroke()
    .restore();
  doc.moveDown(0.2);
}
