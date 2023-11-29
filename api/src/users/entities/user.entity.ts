import type { AtLeast } from '@/common/types';

export class User {
  id: number;
  created_at: Date;
  updated_at: Date;

  email: string;
  first_name: string;
  last_name: string;
  password: string;
  last_sign_in_at: Date;
  is_verified: boolean;
  verification_token: string;
  nb_incorrect_passwords: number;

  aws_credentials: unknown;
  sessions: unknown[];
}

type UserUniqueFields = Pick<User, 'id' | 'email' | 'verification_token'>;

export type UserCreate = Pick<
  User,
  'email' | 'first_name' | 'last_name' | 'password'
>;
export type UserUpdate = Partial<
  Pick<
    User,
    'id' | 'is_verified' | 'last_sign_in_at' | 'nb_incorrect_passwords'
  >
>;
export type UserFindUnique = AtLeast<
  Partial<UserUniqueFields>,
  'id' | 'email' | 'verification_token'
>;
export type UserSetPassword = Pick<User, 'password'>;
export type UserBiometrics = Pick<User, 'id' | 'email'>;
