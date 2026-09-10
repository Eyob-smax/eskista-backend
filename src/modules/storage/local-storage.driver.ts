import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, extname, join, posix } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import type { PutFileParams, StorageDriver, StoredFile } from './storage.interface';

@Injectable()
export class LocalStorageDriver implements StorageDriver {
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = config.get('STORAGE_LOCAL_ROOT', { infer: true });
    this.baseUrl = config.get('STORAGE_PUBLIC_BASE_URL', { infer: true }).replace(/\/$/, '');
  }

  async put({ buffer, originalName, mimeType, folder }: PutFileParams): Promise<StoredFile> {
    // Strip anything that could escape the storage root.
    const safeFolder = folder.replace(/[^a-zA-Z0-9/_-]/g, '');
    const filename = randomUUID() + extname(originalName).toLowerCase();
    const key = posix.join(safeFolder, filename);
    const absolute = join(this.root, key);

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, buffer);

    return { key, url: this.urlFor(key), size: buffer.byteLength, mimeType };
  }

  async remove(key: string): Promise<void> {
    await unlink(join(this.root, key)).catch(() => undefined);
  }

  urlFor(key: string): string {
    return this.baseUrl + '/' + key;
  }
}
