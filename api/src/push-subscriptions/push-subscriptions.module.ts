import { Module } from '@nestjs/common';
import { PushSubscriptionsService } from '@/push-subscriptions/push-subscriptions.service';
import { PushSubscriptionsController } from '@/push-subscriptions/push-subscriptions.controller';

@Module({
  controllers: [PushSubscriptionsController],
  providers: [PushSubscriptionsService]
})
export class PushSubscriptionsModule {}
