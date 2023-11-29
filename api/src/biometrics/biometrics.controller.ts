import {
  Controller,
  UseGuards,
  Get,
  Post,
  Res,
  Body,
  Headers,
  NotFoundException,
  BadRequestException,
  UnauthorizedException
} from '@nestjs/common';
import { BiometricsService } from '@/biometrics/biometrics.service';
import { WebauthnService } from '@/config/webauthn/webauthn.service';
import { UsersService } from '@/users/users.service';
import { SessionsService } from '@/sessions/sessions.service';
import { CryptoService } from '@/config/crypto/crypto.service';
import { JwtService } from '@/config/jwt/jwt.service';
import { AuthGuard } from '@/common/guards/auth.guard';
import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions
} from '@/auth/cookies.params';
import type { Response } from 'express';
import type { CreateBiometricsDto } from '@/biometrics/dto/create-biometrics.dto';
import type { VerifyBiometricsDto } from '@/biometrics/dto/verify-biometrics.dto';

@Controller()
export class BiometricsController {
  constructor(
    private readonly biometricsService: BiometricsService,
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly webauthnService: WebauthnService,
    private readonly cryptoService: CryptoService,
    private readonly jwtService: JwtService
  ) {}

  @UseGuards(AuthGuard)
  @Get('/registration_options')
  async registrationOptions(@Res() response: Response) {
    const id = response.locals.user.id;
    const user = await this.usersService.findUnique({ id }, false);
    if (!user) throw new NotFoundException('biometrics_not_found');
    const options = await this.webauthnService.getRegistrationOptions(user);
    response.status(200).send(options);
  }

  @Get('/assertion_options')
  async assertionOptions() {
    return await this.webauthnService.getAssertionOptions();
  }

  @UseGuards(AuthGuard)
  @Post('/biometrics')
  async create(
    @Res() response: Response,
    @Body() createBiometricsDto: CreateBiometricsDto
  ) {
    const id = response.locals.user.id;
    const { data, challenge } = createBiometricsDto;
    const result = await this.webauthnService.registerResult(data, challenge);

    if (result) {
      await this.biometricsService.create(
        id,
        result.credentialId,
        result.pem,
        result.counter
      );

      response.status(200).send({ credential_id: result.credentialId });
    } else {
      throw new BadRequestException('bionetrics_registration_failed');
    }
  }

  @Post('/verify_biometrics')
  async verify(
    @Res() response: Response,
    @Headers('user-agent') userAgent: string,
    @Body() verifyBiometricsDto: VerifyBiometricsDto
  ) {
    const { data, challenge, credential_id } = verifyBiometricsDto;
    const biometrics =
      await this.biometricsService.findByCredentialId(credential_id);

    if (!biometrics) {
      throw new UnauthorizedException('invalid_credentials');
    }

    const user = biometrics.user;

    const newCounter = await this.webauthnService.assertResult(
      data,
      challenge,
      credential_id,
      biometrics.pem,
      biometrics.counter,
      user.id
    );

    if (newCounter) {
      await this.biometricsService.updateCounter(biometrics.id, newCounter);
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

    response.cookie('pictacularAccTok', accessToken, accessTokenCookieOptions);
    response.cookie(
      'pictacularRefTok',
      refreshToken,
      refreshTokenCookieOptions
    );

    response.status(201).json({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at
    });
  }
}
