import { randomUUID } from 'node:crypto';
import { extname, posix } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import type { Env } from '../../config/env.validation';
import type { PutFileParams, StorageDriver, StoredFile } from './storage.interface';
import { cloudinaryAddress, isPublicMediaKey, isUnsafeKey, safeFolder } from './storage-keys';

/** Signed fetch URLs for private files are short-lived: they are used once, server side. */
const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Stores every photo and document on Cloudinary, using the Node SDK v2 server-side only
 * (`upload_stream` with the buffer, `destroy` by public id) as the cloudinary skill
 * prescribes. The API secret never leaves this process.
 *
 * Two kinds of file, decided by the key (see `storage-keys.ts`):
 *
 *  - **Public media** — catalogue photos, vendor logos, talent avatars and portfolio
 *    covers — are `upload` assets. `urlFor` returns the Cloudinary CDN URL, so the
 *    frontend loads them fast and can apply transformations.
 *  - **Private files** — IDs, business documents, receipts, agreements, signed scans,
 *    reference files — are `authenticated` assets. They cannot be fetched without a
 *    signature, and `urlFor` returns the `/files` endpoint, which checks who is asking
 *    before `read` fetches the bytes with a short-lived signed URL.
 *
 * Keys are unchanged from the local driver, so switching drivers needs no database change —
 * only the files copied across (`pnpm storage:migrate`).
 */
@Injectable()
export class CloudinaryStorageDriver implements StorageDriver {
  private readonly logger = new Logger(CloudinaryStorageDriver.name);
  private readonly filesBaseUrl: string;
  private readonly prefix: string;

  constructor(config: ConfigService<Env, true>) {
    cloudinary.config({
      cloud_name: config.get('CLOUDINARY_CLOUD_NAME', { infer: true }),
      api_key: config.get('CLOUDINARY_API_KEY', { infer: true }),
      api_secret: config.get('CLOUDINARY_API_SECRET', { infer: true }),
      secure: true,
    });
    this.filesBaseUrl = config.get('STORAGE_PUBLIC_BASE_URL', { infer: true }).replace(/\/$/, '');
    this.prefix = config.get('CLOUDINARY_FOLDER', { infer: true });
  }

  async put({ buffer, originalName, mimeType, folder }: PutFileParams): Promise<StoredFile> {
    const key = posix.join(safeFolder(folder), randomUUID() + extname(originalName).toLowerCase());
    await this.upload(key, buffer);
    return { key, url: this.urlFor(key), size: buffer.byteLength, mimeType };
  }

  /**
   * Uploads under an exact key. Public for the migration script, which copies existing
   * files across keeping their keys. Overwrites, so re-running it is safe.
   */
  async upload(key: string, buffer: Buffer): Promise<UploadApiResponse> {
    this.assertSafe(key);
    const address = cloudinaryAddress(key, this.prefix);

    return new Promise<UploadApiResponse>((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: address.publicId,
            resource_type: address.resourceType,
            type: address.deliveryType,
            overwrite: true,
            invalidate: true,
            // The key already names the file; stop Cloudinary adding its own suffix.
            use_filename: false,
            unique_filename: false,
          },
          (error, result) => {
            if (error || !result) {
              reject(
                new Error(`Cloudinary upload failed for ${key}: ${error?.message ?? 'no result'}`),
              );
              return;
            }
            resolve(result);
          },
        )
        .end(buffer);
    });
  }

  /** Fetches the bytes — for the authorised files endpoint and for frozen agreement text. */
  async read(key: string): Promise<Buffer> {
    this.assertSafe(key);
    const response = await fetch(this.serverFetchUrl(key));
    if (!response.ok) {
      throw new Error(`Cloudinary returned ${response.status} for ${key}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    this.assertSafe(key);
    const address = cloudinaryAddress(key, this.prefix);
    try {
      const result = (await cloudinary.uploader.destroy(address.publicId, {
        resource_type: address.resourceType,
        type: address.deliveryType,
        invalidate: true,
      })) as { result?: string };
      // "not found" is fine: the goal is that the file is gone.
      if (result.result !== 'ok' && result.result !== 'not found') {
        this.logger.warn(`Cloudinary destroy for ${key} returned ${String(result.result)}`);
      }
    } catch (error) {
      this.logger.warn(`Could not delete ${key} from Cloudinary: ${String(error)}`);
    }
  }

  /**
   * The URL a client is given. Public media goes straight to the CDN; anything private goes
   * through `/files`, never a Cloudinary URL — a signed URL handed to a browser can be
   * forwarded, and the permission check is the point.
   */
  urlFor(key: string): string {
    if (isPublicMediaKey(key)) return this.deliveryUrl(key);
    return this.filesBaseUrl + '/' + key;
  }

  /** The public CDN URL, in the stored format. Only ever used for public media. */
  private deliveryUrl(key: string): string {
    const address = cloudinaryAddress(key, this.prefix);
    return cloudinary.url(address.publicId, {
      resource_type: address.resourceType,
      type: address.deliveryType,
      secure: true,
      ...(address.resourceType === 'image' ? { format: this.formatOf(key) } : {}),
    });
  }

  /**
   * A URL this server uses once to fetch the bytes. Private files get a download URL signed
   * with the API secret that expires in five minutes; public media is simply its CDN URL.
   */
  private serverFetchUrl(key: string): string {
    const address = cloudinaryAddress(key, this.prefix);
    if (address.deliveryType === 'upload') return this.deliveryUrl(key);
    return cloudinary.utils.private_download_url(
      address.publicId,
      address.resourceType === 'image' ? this.formatOf(key) : '',
      {
        resource_type: address.resourceType,
        type: address.deliveryType,
        expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
        attachment: false,
      },
    );
  }

  private formatOf(key: string): string {
    return extname(key).slice(1).toLowerCase();
  }

  private assertSafe(key: string): void {
    if (isUnsafeKey(key)) throw new Error(`Refusing unsafe storage key: ${key}`);
  }
}
