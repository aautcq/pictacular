import { Injectable } from '@nestjs/common';
import {
  hashSync as bcryptHashSync,
  compareSync as bcryptCompareSync,
  genSaltSync as bcryptGenSaltSync
} from 'bcrypt';
import { randomBytes as cryptoRandomBytes } from 'crypto';

@Injectable()
export class CryptoService {
  constructor() {}

  generateRandomString(length: number): string {
    return cryptoRandomBytes(length).toString('base64url');
  }

  hash(password: string): string {
    const salt = bcryptGenSaltSync(10);
    return bcryptHashSync(password, salt);
  }

  compare(password: string, hash: string): boolean {
    return bcryptCompareSync(password, hash);
  }
}
