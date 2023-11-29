import { accessTokenTtl, refreshTokenTtl } from '@/config/jwt/jwt.service';

type GenericCookieOptions = {
  httpOnly: boolean;
  sameSite: 'none';
  secure: boolean;
  path: string;
  domain: string;
};

type CookieOptions = GenericCookieOptions & {
  maxAge: number;
};

const genericCookieOptions: GenericCookieOptions = {
  httpOnly: true,
  sameSite: 'none',
  secure: true,
  path: '/',
  domain: process.env.COOKIE_DOMAIN
};

export const accessTokenCookieOptions: CookieOptions = {
  ...genericCookieOptions,
  maxAge: accessTokenTtl * 1000
};

export const refreshTokenCookieOptions: CookieOptions = {
  ...genericCookieOptions,
  maxAge: refreshTokenTtl * 1000
};
