import { Global, Module } from '@nestjs/common';
import { CryptoService } from '@/config/crypto/crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService]
})
export class CryptoModule {}
