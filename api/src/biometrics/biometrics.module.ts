import { Module } from '@nestjs/common';
import { BiometricsService } from '@/biometrics/biometrics.service';
import { BiometricsController } from '@/biometrics/biometrics.controller';
import { UsersService } from '@/users/users.service';
import { SessionsService } from '@/sessions/sessions.service';

@Module({
  controllers: [BiometricsController],
  providers: [BiometricsService, UsersService, SessionsService]
})
export class BiometricsModule {}
