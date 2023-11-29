import { Module, Global } from '@nestjs/common';
import { MailerService } from '@/config/mailer/mailer.service';

@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService]
})
export class MailerModule {}
