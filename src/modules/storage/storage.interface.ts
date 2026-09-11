export interface StoredFile {
  key: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface PutFileParams {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folder: string;
}

/**
 * Storage sits behind an interface so the local-disk driver used now can be
 * swapped for an S3-compatible driver later without touching call sites.
 */
export interface StorageDriver {
  put(params: PutFileParams): Promise<StoredFile>;
  /** Reads a stored object back. Used for frozen agreement bodies, never for user media. */
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  urlFor(key: string): string;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
