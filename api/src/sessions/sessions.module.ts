import { Module } from '@nestjs/common';
import { SessionsService } from '@/sessions/sessions.service';
import { SessionsController } from '@/sessions/sessions.controller';

@Module({
  controllers: [SessionsController],
  providers: [SessionsService]
})
export class SessionsModule {}
