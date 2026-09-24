import { BadRequestException } from '@nestjs/common';

/**
 * Minimal shape of a multer file.
 *
 * Declared locally rather than importing `Express.Multer.File`, which would require
 * `@types/multer` as a direct dependency just for one interface.
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'] as const;

/**
 * Reference files on a talent request: "Moodboards, briefs, scripts, reference images,
 * project documents". Adds Word documents, because a brief or script arrives as .docx far
 * more often than as a PDF.
 */
export const REFERENCE_MIME_TYPES = [
  ...DOCUMENT_MIME_TYPES,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

/** Per-purpose limits, matching the designs: 5MB for profile/KYC, 10MB for receipts. */
export const UPLOAD_LIMITS = {
  image: 5 * 1024 * 1024,
  document: 5 * 1024 * 1024,
  receipt: 10 * 1024 * 1024,
  reference: 10 * 1024 * 1024,
} as const;

export interface AssertFileOptions {
  allowed: readonly string[];
  maxBytes: number;
  field?: string;
}

/**
 * Validates an upload before it reaches storage.
 *
 * Checks the declared MIME type and size only. A declared type is client-supplied and
 * therefore untrusted — it is enough to reject honest mistakes, not a defence against a
 * hostile upload. Anything served back to browsers must also be sent with an explicit
 * `Content-Type` and `Content-Disposition`, never sniffed.
 */
export function assertValidFile(
  file: UploadedFile | undefined,
  { allowed, maxBytes, field = 'file' }: AssertFileOptions,
): UploadedFile {
  if (!file) {
    throw new BadRequestException(`${field} is required`);
  }
  if (!allowed.includes(file.mimetype)) {
    throw new BadRequestException(
      `${field} must be one of: ${allowed.join(', ')} (received ${file.mimetype})`,
    );
  }
  if (file.size > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    throw new BadRequestException(`${field} must be ${mb}MB or smaller`);
  }
  if (!file.buffer || file.buffer.byteLength === 0) {
    throw new BadRequestException(`${field} is empty`);
  }
  return file;
}
