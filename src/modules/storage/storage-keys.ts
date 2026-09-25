import { extname } from 'node:path';

/**
 * Rules about storage keys, shared by the drivers and `FileAccessService`.
 *
 * A key is `<scope>/<owner>/<area>/…/<uuid><ext>` — `talent/<id>/public/avatar/…`,
 * `bookings/<reference>/agreements/…`. Everything about a file (who may read it, whether
 * it can sit on a public CDN, what kind of Cloudinary resource it is) is derived from the
 * key, so no second table can drift out of step with the object.
 */

/** Extensions stored as Cloudinary `image` resources; everything else is `raw`. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * Media anyone may see: catalogue photos, category art, a vendor's logo, and a talent's
 * public profile (avatar, portfolio covers).
 *
 * These may live on a public CDN. Everything else — IDs, business documents, receipts,
 * agreements, signed scans, reference files — is private and only ever leaves storage
 * through the authorised `/files` endpoint.
 */
export function isPublicMediaKey(key: string): boolean {
  const [scope, , area] = key.split('/');
  if (scope === 'listings' || scope === 'categories') return true;
  if (scope === 'vendors' && area === 'logo') return true;
  if (scope === 'talent' && area === 'public') return true;
  return false;
}

export type CloudinaryResourceType = 'image' | 'raw';
export type CloudinaryDeliveryType = 'upload' | 'authenticated';

export interface CloudinaryAddress {
  publicId: string;
  resourceType: CloudinaryResourceType;
  /** `upload` is public on the CDN; `authenticated` needs a signed URL to fetch. */
  deliveryType: CloudinaryDeliveryType;
}

/**
 * Where a key lives in Cloudinary.
 *
 * Images drop their extension from the public id (Cloudinary stores the format itself and
 * appends it on delivery); raw files keep it, because a raw public id is the whole name.
 * The key keeps the extension either way — the files endpoint reads the content type
 * from it.
 */
export function cloudinaryAddress(key: string, prefix = ''): CloudinaryAddress {
  const ext = extname(key).toLowerCase();
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const base = prefix ? `${prefix.replace(/\/$/, '')}/${key}` : key;
  return {
    publicId: isImage ? base.slice(0, base.length - ext.length) : base,
    resourceType: isImage ? 'image' : 'raw',
    deliveryType: isPublicMediaKey(key) ? 'upload' : 'authenticated',
  };
}

/** Rejects traversal and absolute paths. Keys come from database rows, not only from us. */
export function isUnsafeKey(key: string): boolean {
  return (
    !key ||
    key.includes('..') ||
    key.startsWith('/') ||
    key.startsWith('\\') ||
    /^[a-zA-Z]:/.test(key)
  );
}

/** Keeps folders to a safe alphabet, so a caller-supplied segment cannot escape. */
export function safeFolder(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9/_-]/g, '');
}
