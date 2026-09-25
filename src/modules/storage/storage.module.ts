import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.validation';
import { CloudinaryStorageDriver } from './cloudinary-storage.driver';
import { FileAccessService } from './file-access.service';
import { FilesController } from './files.controller';
import { LocalStorageDriver } from './local-storage.driver';
import { STORAGE_DRIVER } from './storage.interface';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    {
      provide: STORAGE_DRIVER,
      inject: [ConfigService],
      // One driver for the whole app, picked by STORAGE_DRIVER. Call sites only ever see
      // the StorageDriver interface.
      useFactory: (config: ConfigService<Env, true>) => {
        const driver = config.get('STORAGE_DRIVER', { infer: true });
        new Logger('StorageModule').log(`File storage: ${driver}`);
        return driver === 'cloudinary'
          ? new CloudinaryStorageDriver(config)
          : new LocalStorageDriver(config);
      },
    },
    FileAccessService,
  ],
  exports: [STORAGE_DRIVER, FileAccessService],
})
export class StorageModule {}
