import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { CloudinaryStorageDriver } from './cloudinary-storage.driver';
import { isUnsafeKey } from './storage-keys';

export interface SyncReport {
  uploaded: number;
  failed: { key: string; error: string }[];
}

/**
 * Copies every file under the local storage root to Cloudinary, keeping its key.
 *
 * Keys are identical under both drivers, so the database needs no change: once this has
 * run, switching `STORAGE_DRIVER` to `cloudinary` serves the same rows from Cloudinary.
 * Uploads overwrite, so running it twice is harmless. Used by `pnpm storage:migrate` and by
 * the seed, whose frozen demo documents are written to local disk first.
 */
export async function syncLocalToCloudinary(
  config: Pick<ConfigService<Env, true>, 'get'>,
  log: (line: string) => void = () => undefined,
): Promise<SyncReport> {
  const root = config.get('STORAGE_LOCAL_ROOT', { infer: true });
  const driver = new CloudinaryStorageDriver(config as ConfigService<Env, true>);
  const report: SyncReport = { uploaded: 0, failed: [] };

  for await (const absolute of walk(root)) {
    const key = relative(root, absolute).split(sep).join('/');
    if (isUnsafeKey(key)) continue;
    try {
      await driver.upload(key, await readFile(absolute));
      report.uploaded += 1;
      log(`  ✓ ${key}`);
    } catch (error) {
      report.failed.push({ key, error: String(error) });
      log(`  ✗ ${key}: ${String(error)}`);
    }
  }
  return report;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // no local storage yet: nothing to copy
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/** A `ConfigService` stand-in for scripts that run outside Nest, validated like the app. */
export function scriptConfig(env: Env): Pick<ConfigService<Env, true>, 'get'> {
  return { get: (key: keyof Env) => env[key] };
}
