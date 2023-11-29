import {
  Body,
  ConflictException,
  Controller,
  Headers,
  Param,
  Get,
  Post,
  Res,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { UsersService } from '@/users/users.service';
import { SessionsService } from '@/sessions/sessions.service';
import { AuthService } from '@/auth/auth.service';
import { CryptoService } from '@/config/crypto/crypto.service';
import { JwtService } from '@/config/jwt/jwt.service';
import { MailerService } from '@/config/mailer/mailer.service';
import { StorageService } from '@/config/storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@/common/guards/auth.guard';
import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions
} from '@/auth/cookies.params';
import type { RegisterDto } from '@/auth/dto/register.dto';
import type { LoginDto } from '@/auth/dto/login.dto';
import type { ResetPasswordDto } from '@/auth/dto/reset-password.dto';
import type { SetPasswordDto } from '@/auth/dto/set-password.dto';
import type { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly authService: AuthService,
    private readonly cryptoService: CryptoService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService
  ) {}

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Headers('user-agent') userAgent: string,
    @Res() response: Response
  ) {
    const { email, password } = loginDto;
    const user = await this.usersService.findUnique({ email }, true);
    if (!user) throw new UnauthorizedException('invalid_credentials');
    if (!user.is_verified) {
      throw new UnauthorizedException('invalid_credentials');
    }
    if (user.nb_incorrect_passwords >= 5) {
      const clientUrl = this.configService.get<string>('CLIENT_URL');

      const token = await this.authService.generateResetPasswordToken(email);
      this.mailerService.sendEmail(
        {
          email,
          link: `${clientUrl}/reset-password/${token}`
        },
        'password-reset'
      );
      throw new UnauthorizedException('invalid_credentials');
    }

    const isPasswordValid = this.cryptoService.compare(password, user.password);
    if (!isPasswordValid) {
      await this.usersService.update(user.id, {
        nb_incorrect_passwords: user.nb_incorrect_passwords + 1
      });
      throw new UnauthorizedException('invalid_credentials');
    }

    if (user.nb_incorrect_passwords > 0) {
      await this.usersService.update(user.id, {
        nb_incorrect_passwords: 0
      });
    }

    const session = await this.sessionsService.create({
      user_id: user.id,
      user_agent: userAgent,
      active: true
    });
    this.sessionsService.revokeAllExceptOne({
      id: session.id,
      user_id: user.id
    });

    const { last_sign_in_at } = await this.usersService.update(user.id, {
      last_sign_in_at: new Date()
    });

    const { accessToken, refreshToken } = await this.jwtService.createTokens(
      user,
      session
    );
    const refreshTokenHash = this.cryptoService.hash(refreshToken);
    await this.sessionsService.update({
      id: session.id,
      refresh_token: refreshTokenHash
    });

    let secure_url = null;
    if (user?.avatar_url && user.aws_credentials?.id) {
      this.storageService.initWithBucket(user?.aws_credentials);
      secure_url = await this.storageService.generateSecureUrl(user.avatar_url);
    }

    response.cookie('pictacularAccTok', accessToken, accessTokenCookieOptions);
    response.cookie(
      'pictacularRefTok',
      refreshToken,
      refreshTokenCookieOptions
    );

    response.status(201).json({
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      has_aws_credentials: !!user.aws_credentials?.id ?? false,
      avatar_url: secure_url,
      created_at: user.created_at,
      last_sign_in_at
    });
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Res() response: Response) {
    await this.sessionsService.update({
      id: response.locals.session.id,
      active: false,
      refresh_token: null
    });

    response.clearCookie('pictacularAccTok', accessTokenCookieOptions);
    response.clearCookie('pictacularRefTok', refreshTokenCookieOptions);
    response.status(204).send();
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto, @Res() response: Response) {
    const { email, password, first_name, last_name } = registerDto;
    const passwordHash = this.cryptoService.hash(password);
    const emailTaken = await this.usersService.findUnique({ email });
    if (emailTaken) throw new ConflictException('email_taken');
    const user = await this.usersService.create({
      email,
      first_name,
      last_name,
      password: passwordHash
    });

    const clientUrl = this.configService.get<string>('CLIENT_URL');
    this.mailerService.sendEmail(
      {
        email,
        link: `${clientUrl}/verification/${user.verification_token}`
      },
      'verification'
    );
    response.status(204).send();
  }

  @Get('verify/:token')
  async verify(@Param('token') token: string, @Res() response: Response) {
    const user = await this.usersService.findUnique({
      verification_token: token
    });
    if (!user) throw new UnauthorizedException('invalid_token');
    await this.usersService.update(user.id, {
      is_verified: true
    });
    response.status(204).send();
  }

  @Post('reset-password')
  async resetPassword(
    @Body() resetPasswordDto: ResetPasswordDto,
    @Res() response: Response
  ) {
    const clientUrl = this.configService.get<string>('CLIENT_URL');
    const { email } = resetPasswordDto;
    const user = await this.usersService.findUnique({ email });
    if (!user) response.status(204).send();
    const token = await this.authService.generateResetPasswordToken(email);
    this.mailerService.sendEmail(
      {
        email,
        link: `${clientUrl}/reset-password/${token}`
      },
      'password-reset'
    );
    response.status(204).send();
  }

  @Post('reset-password/:token')
  async setPassword(
    @Body() setPasswordDto: SetPasswordDto,
    @Param('token') token: string,
    @Res() response: Response
  ) {
    await this.authService.setNewPassword(setPasswordDto, token);
    response.status(204).send();
  }
}
