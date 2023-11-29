import { Module } from '@nestjs/common';
import { GatewayService } from '@/config//gateway/gateway.service';

@Module({
  providers: [GatewayService],
  exports: [GatewayService]
})
export class GatewayModule {}
