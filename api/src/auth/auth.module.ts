import { Module } from '@nestjs/common';
import { AuthController } from '@/auth/auth.controller';
import { UsersService } from '@/users/users.service';
import { NotificationsSettingsService } from '@/notifications-settings/notifications-settings.service';
import { SessionsService } from '@/sessions/sessions.service';
import { AuthService } from '@/auth/auth.service';

@Module({
  imports: [],
  providers: [
    UsersService,
    NotificationsSettingsService,
    SessionsService,
    AuthService
  ],
  controllers: [AuthController]
})
export class AuthModule {}
