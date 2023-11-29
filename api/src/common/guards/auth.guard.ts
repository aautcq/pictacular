import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException
} from '@nestjs/common';
import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions
} from '@/auth/cookies.params';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const response = context.switchToHttp().getResponse();
    const user = response.locals.user;
    const session = response.locals.session;

    if (!user || !session) {
      response.clearCookie('pictacularAccTok', accessTokenCookieOptions);
      response.clearCookie('pictacularRefTok', refreshTokenCookieOptions);
      throw new UnauthorizedException();
    }

    return true;
  }
}
