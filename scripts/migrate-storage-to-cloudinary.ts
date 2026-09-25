/**
 * Copies every file in local storage to Cloudinary, keeping each key.
 *
 *   pnpm storage:migrate
 *
 * Needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in `.env`.
 * Safe to re-run: uploads overwrite. The database is not touched — keys are the same under
 * both drivers — so after it succeeds, start the API with STORAGE_DRIVER=cloudinary (the
 * default once the credentials are set).
 */
import { existsSync } from 'node:fs';
import { validateEnv } from '../src/config/env.validation';
import { scriptConfig, syncLocalToCloudinary } from '../src/modules/storage/sync-to-cloudinary';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = validateEnv({ ...process.env, STORAGE_DRIVER: 'cloudinary' });
  console.log(`Copying ${env.STORAGE_LOCAL_ROOT} to Cloudinary folder "${env.CLOUDINARY_FOLDER}"…`);

  const report = await syncLocalToCloudinary(scriptConfig(env), (line) => console.log(line));

  console.log(`\nUploaded ${report.uploaded} file(s), ${report.failed.length} failed.`);
  if (report.failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
