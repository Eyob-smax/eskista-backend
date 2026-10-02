import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';

export const PDF_CONTENT = {
  'application/pdf': { schema: { type: 'string', format: 'binary' } },
};

export const CSV_CONTENT = { 'text/csv': { schema: { type: 'string' } } };

export function sendPdf(res: Response, buffer: Buffer, filename: string): StreamableFile {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(buffer);
}

/** "Export Summary": a CSV download, with a BOM so Excel reads Amharic names correctly. */
export function sendCsv(res: Response, csv: string, name: string): StreamableFile {
  const day = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}-${day}.csv"`,
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(Buffer.from(`\uFEFF${csv}`, 'utf-8'));
}
