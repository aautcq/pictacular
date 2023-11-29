import { Global, Module } from '@nestjs/common';
import { JwtModule as NestJwtModule } from '@nestjs/jwt';
import { JwtService } from '@/config/jwt/jwt.service';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '@/users/users.service';
import { SessionsService } from '@/sessions/sessions.service';

@Global()
@Module({
  imports: [
    NestJwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        privateKey: configService.get<string>('JWT_PRIVATE_KEY'),
        publicKey: configService.get<string>('JWT_PUBLIC_KEY')
      })
    })
  ],
  providers: [JwtService, UsersService, SessionsService],
  exports: [JwtService]
})
export class JwtModule {}
