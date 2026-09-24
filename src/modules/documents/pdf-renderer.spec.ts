import { renderAgreementPdf } from './pdf-renderer';

const BASE = {
  title: 'Equipment Rental Agreement',
  reference: 'ESK-10482',
  meta: [
    { label: 'Ref', value: 'ESK-10482' },
    { label: 'Governed by', value: 'Ethiopian Law' },
  ],
  body: [
    '# EQUIPMENT RENTAL AGREEMENT',
    '',
    '**1. EQUIPMENT USE**',
    'The renter agrees to utilise the equipment solely for its intended purpose.',
    '',
    '- Pack all included items.',
    '- Return batteries and memory cards.',
  ].join('\n'),
  contentHash: 'sha256:44b94a728d33725d2',
  signerName: 'Selam Tesfaye',
  signedAt: new Date('2026-08-17T09:12:00Z'),
};

describe('renderAgreementPdf', () => {
  it('produces a real PDF', async () => {
    const pdf = await renderAgreementPdf(BASE);

    expect(pdf.length).toBeGreaterThan(1000);
    // Every PDF starts with this signature; anything else is not openable.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('EOF');
  });

  it('renders without a signature, for a contract not yet signed', async () => {
    const pdf = await renderAgreementPdf({ ...BASE, signerName: null, signedAt: null });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders when the content hash is missing rather than throwing', async () => {
    // A document with no hash is a defect worth surfacing, but refusing to render it
    // would leave the customer unable to read their own contract at all.
    const pdf = await renderAgreementPdf({ ...BASE, contentHash: null });
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('handles an empty body without producing a broken file', async () => {
    const pdf = await renderAgreementPdf({ ...BASE, body: '' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('paginates a long contract instead of overflowing one page', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Clause ${i}: terms and conditions.`).join(
      '\n',
    );
    const short = await renderAgreementPdf(BASE);
    const paged = await renderAgreementPdf({ ...BASE, body: long });

    expect(paged.length).toBeGreaterThan(short.length);
    // More than one page object means the renderer actually broke the text up.
    const pageCount = (paged.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
  });

  it('is deterministic enough that the same input gives the same length', async () => {
    const [a, b] = await Promise.all([renderAgreementPdf(BASE), renderAgreementPdf(BASE)]);
    expect(a.length).toBe(b.length);
  });
});
