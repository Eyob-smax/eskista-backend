import { extname } from 'node:path';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.types';
import { FileAccessService } from './file-access.service';
import { STORAGE_DRIVER, type StorageDriver } from './storage.interface';

/** Content types we are willing to serve back, keyed by extension. */
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

@ApiTags('files')
@ApiBearerAuth()
@Controller({ path: 'files', version: '1' })
export class FilesController {
  constructor(
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
    private readonly access: FileAccessService,
  ) {}

  // Express 5 / path-to-regexp v8: `:key(*)` is no longer valid. A named wildcard captures
  // the remaining path segments, which arrive as an array and are rejoined below — storage
  // keys contain slashes (`vendors/<id>/documents/<file>`).
  @Get('*key')
  @ApiOperation({
    summary: 'Download an uploaded file',
    description: [
      'Streams a stored file to callers entitled to read it.',
      '',
      'This endpoint replaced public static hosting of the upload directory. That',
      'directory holds Fayda ID scans, business registrations, payment receipts and',
      'signed agreements, so an unguessable URL was never adequate protection — URLs leak',
      'through logs, proxies and forwarded messages.',
      '',
      '**Who may read what**, derived from the key prefix:',
      '',
      '| Key prefix | Readable by |',
      '| --- | --- |',
      '| `listings/…` | anyone signed in — catalogue photos are public marketing content |',
      '| `vendors/<vendorId>/…` | that vendor, and admins |',
      '| `talent/<talentProfileId>/…` | that talent, and admins |',
      '| `customers/<userId>/…` | that customer, and admins |',
      '| `bookings/<reference>/…` | the customer, the supplying vendor or talent, and admins |',
      '',
      'Anything else is refused. New upload folders must be granted access explicitly.',
      '',
      'An entitled-but-wrong caller receives **404, not 403**: a 403 would confirm that a',
      'particular vendor, booking or customer exists.',
    ].join('\n'),
  })
  @ApiParam({
    name: 'key',
    description:
      'Storage key exactly as returned by an upload or in a resource payload, including ' +
      'slashes. Do not URL-encode the slashes.',
    example: 'vendors/7c9e6679-7425-40de-944b-e07fc1f90ae7/documents/fayda.pdf',
  })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    description: 'The file, with its real Content-Type and an attachment disposition.',
  })
  @ApiUnauthorizedResponse({ description: 'No valid session.' })
  async download(
    @CurrentUser() user: SessionUser,
    @Param('key') rawKey: string | string[],
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // A wildcard param arrives as the array of path segments.
    const key = Array.isArray(rawKey) ? rawKey.join('/') : rawKey;

    await this.access.assertCanRead(user, key);

    let buffer: Buffer;
    try {
      buffer = await this.storage.read(key);
    } catch {
      // A key recorded in the database with no file behind it is an operational fault,
      // but to the caller it is simply absent.
      throw new NotFoundException('File not found');
    }

    const extension = extname(key).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';
    const filename = key.split('/').pop() ?? 'download';

    res.set({
      'Content-Type': contentType,
      // `attachment` rather than `inline`: a stored PDF or SVG rendered in the browser on
      // our own origin would be a stored-XSS vector.
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Content-Length': String(buffer.byteLength),
      // These are per-user private documents; no shared cache should retain them.
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(buffer);
  }
}
