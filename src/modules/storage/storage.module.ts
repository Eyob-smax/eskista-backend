import { Global, Module } from '@nestjs/common';
import { LocalStorageDriver } from './local-storage.driver';
import { STORAGE_DRIVER } from './storage.interface';

@Global()
@Module({
  providers: [{ provide: STORAGE_DRIVER, useClass: LocalStorageDriver }],
  exports: [STORAGE_DRIVER],
})
export class StorageModule {}
