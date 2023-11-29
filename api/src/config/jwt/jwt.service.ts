import { SessionsService } from '@/sessions/sessions.service';
import { UsersService } from '@/users/users.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { CryptoService } from '@/config/crypto/crypto.service';
import type { User } from '@/users/entities/user.entity';
import type { Session } from '@/sessions/entities/session.entity';

export interface AccessToken {
  user: {
    id: number;
    nickname: string;
    email: string;
  };
  session: {
    id: number;
  };
}

export interface RefreshToken {
  userId: number;
  sessionId: number;
}

export const accessTokenTtl = 15 * 50; // In seconds (15 minutes)
export const refreshTokenTtl = 7 * 24 * 60 * 60; // In seconds (7 days)

@Injectable()
export class JwtService {
  constructor(
    private readonly nestJwtService: NestJwtService,
    private readonly sessionsService: SessionsService,
    private readonly usersService: UsersService,
    private readonly cryptoService: CryptoService
  ) {}

  async createTokens(
    user: Pick<User, 'id' | 'email'>,
    session: Pick<Session, 'id'>
  ) {
    const accessTokenPayload = {
      user: {
        id: user.id,
        email: user.email
      },
      session: {
        id: session.id
      }
    };
    const accessToken = this.nestJwtService.sign(accessTokenPayload, {
      expiresIn: accessTokenTtl,
      algorithm: 'RS256',
      privateKey: process.env.JWT_PRIVATE_KEY
    });

    const refreshTokenPayload = {
      userId: user.id,
      sessionId: session.id
    };
    const refreshToken = this.nestJwtService.sign(refreshTokenPayload, {
      expiresIn: refreshTokenTtl,
      algorithm: 'RS256',
      privateKey: process.env.JWT_PRIVATE_KEY
    });

    return { accessToken, refreshToken };
  }

  verify<T>(token: string) {
    try {
      return this.nestJwtService.verify(token, {
        algorithms: ['RS256'],
        publicKey: process.env.JWT_PUBLIC_KEY
      }) as T;
    } catch (error) {
      return null;
    }
  }

  async reIssueAccessToken(token: string) {
    const decoded = this.verify<RefreshToken>(token);
    if (!decoded) throw new UnauthorizedException('invalid_token');

    const session = await this.sessionsService.findUnique({
      id: decoded.sessionId
    });
    const isRefreshTokenValid = this.cryptoService.compare(
      token,
      session.refresh_token ?? ''
    );
    if (!isRefreshTokenValid || !session.active)
      throw new UnauthorizedException('invalid_token');

    const user = await this.usersService.findUnique({ id: decoded.userId });

    const { accessToken, refreshToken } = await this.createTokens(
      user,
      session
    );

    await this.sessionsService.update({
      id: session.id,
      refresh_token: this.cryptoService.hash(refreshToken)
    });

    return {
      newAccessToken: accessToken,
      newRefreshToken: refreshToken
    };
  }
}
