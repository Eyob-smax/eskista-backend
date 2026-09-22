import { Global, Module } from '@nestjs/common';
import { FileAccessService } from './file-access.service';
import { FilesController } from './files.controller';
import { LocalStorageDriver } from './local-storage.driver';
import { STORAGE_DRIVER } from './storage.interface';

@Global()
@Module({
  controllers: [FilesController],
  providers: [{ provide: STORAGE_DRIVER, useClass: LocalStorageDriver }, FileAccessService],
  exports: [STORAGE_DRIVER, FileAccessService],
})
export class StorageModule {}
