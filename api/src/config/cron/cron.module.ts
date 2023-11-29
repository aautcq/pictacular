import { Module } from '@nestjs/common';
import { CronService } from '@/config/cron/cron.service';
import { GatewayService } from '@/config/gateway/gateway.service';
import { UsersService } from '@/users/users.service';
import { FlashcardsService } from '@/flashcards/flashcards.service';
import { PushSubscriptionsService } from '@/push-subscriptions/push-subscriptions.service';
import { NotificationsSettingsService } from '@/notifications-settings/notifications-settings.service';
import { MailerService } from '@/config/mailer/mailer.service';

@Module({
  providers: [
    CronService,
    GatewayService,
    UsersService,
    FlashcardsService,
    PushSubscriptionsService,
    NotificationsSettingsService,
    MailerService
  ],
  exports: [CronService]
})
export class CronModule {}
