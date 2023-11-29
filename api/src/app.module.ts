import { Module, NestModule, type MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { I18nModule, AcceptLanguageResolver } from 'nestjs-i18n';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from '@/config/prisma/prisma.module';
import { StorageModule } from '@/config/storage/storage.module';
import { CryptoModule } from '@/config/crypto/crypto.module';
import { JwtModule } from '@/config/jwt/jwt.module';
import { MailerModule } from '@/config/mailer/mailer.module';
import { WebauthnModule } from '@/config/webauthn/webauthn.module';
import { GatewayModule } from '@/config/gateway/gateway.module';
import { CronModule } from '@/config/cron/cron.module';
import { UsersModule } from '@/users/users.module';
import { SessionsModule } from '@/sessions/sessions.module';
import { AuthModule } from '@/auth/auth.module';
import { AuthMiddleware } from '@/common/middlewares/auth.middleware';
import { PushSubscriptionsModule } from '@/push-subscriptions/push-subscriptions.module';
import { BiometricsModule } from './biometrics/biometrics.module';
import * as path from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),

    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(__dirname, '/i18n/'),
        watch: true
      },
      resolvers: [AcceptLanguageResolver]
    }),

    // for cron jobs
    ScheduleModule.forRoot(),
    CronModule,

    // websockets
    GatewayModule,

    // Config
    PrismaModule,
    StorageModule,
    CryptoModule,
    JwtModule,
    MailerModule,
    WebauthnModule,

    // Security
    AuthModule,

    // Ressources
    UsersModule,
    SessionsModule,
    PushSubscriptionsModule,
    BiometricsModule
  ],
  providers: []
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('*');
  }
}
