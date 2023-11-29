import { Global, Module } from '@nestjs/common';
import { StorageService } from '@/config/storage/storage.service';

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService]
})
export class CryptoModule {}
