import { Module, Global } from '@nestjs/common';
import { WebauthnService } from '@/config/webauthn/webauthn.service';

@Global()
@Module({
  providers: [WebauthnService],
  exports: [WebauthnService]
})
export class WebauthnModule {}
