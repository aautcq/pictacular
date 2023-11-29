import { type AccessToken, JwtService } from '@/config/jwt/jwt.service';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions
} from '@/auth/cookies.params';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  async use(request: Request, response: Response, next: () => void) {
    if (!request.cookies) return next();
    const { memowiseAccTok: accessToken, memowiseRefTok: refreshToken } =
      request.cookies;
    if (!refreshToken) return next();

    try {
      const accessTokenPayload =
        this.jwtService.verify<AccessToken>(accessToken);
      response.locals.user = accessTokenPayload.user;
      response.locals.session = accessTokenPayload.session;
      return next();
    } catch (error) {
      //
    }

    try {
      const { newAccessToken, newRefreshToken } =
        await this.jwtService.reIssueAccessToken(refreshToken);

      response.cookie(
        'memowiseAccTok',
        newAccessToken,
        accessTokenCookieOptions
      );
      response.cookie(
        'memowiseRefTok',
        newRefreshToken,
        refreshTokenCookieOptions
      );

      const { user, session } =
        this.jwtService.verify<AccessToken>(newAccessToken);
      response.locals.user = user;
      response.locals.session = session;
    } catch (error) {
      //
    }

    next();
  }
}
