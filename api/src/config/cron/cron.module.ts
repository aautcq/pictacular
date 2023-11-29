import { Module } from '@nestjs/common';
import { CronService } from '@/config/cron/cron.service';
import { GatewayService } from '@/config/gateway/gateway.service';
import { UsersService } from '@/users/users.service';
import { PushSubscriptionsService } from '@/push-subscriptions/push-subscriptions.service';
import { MailerService } from '@/config/mailer/mailer.service';

@Module({
  providers: [
    CronService,
    GatewayService,
    UsersService,
    PushSubscriptionsService,
    MailerService
  ],
  exports: [CronService]
})
export class CronModule {}
