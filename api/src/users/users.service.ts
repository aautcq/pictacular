import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/prisma/prisma.service';
import { CryptoService } from '@/config/crypto/crypto.service';

import type {
  UserCreate,
  UserUpdate,
  UserFindUnique
} from '@/users/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cryptoService: CryptoService
  ) {}

  private async getFreshToken() {
    let token = '';
    do {
      token = this.cryptoService.generateRandomString(32);
    } while (
      await this.prismaService.user.findFirst({
        where: { verification_token: token }
      })
    );
    return token;
  }

  async create(data: UserCreate) {
    const token = await this.getFreshToken();

    return this.prismaService.user.create({
      data: {
        ...data,
        verification_token: token
      },
      select: {
        id: true,
        email: true,
        verification_token: true
      }
    });
  }

  async findUnique(data: UserFindUnique, password = false) {
    return this.prismaService.user.findUnique({
      where: {
        id: data?.id,
        email: data?.email,
        verification_token: data?.verification_token
      },
      select: {
        id: true,
        created_at: true,
        email: true,
        first_name: true,
        last_name: true,
        is_verified: true,
        verification_token: true,
        last_sign_in_at: true,
        nb_incorrect_passwords: true,
        aws_credentials: true,
        avatar_url: true,
        password
      }
    });
  }

  async findAll() {
    return await this.prismaService.user.findMany({
      where: {
        is_verified: true
      },
      select: {
        id: true
      }
    });
  }

  async update(id: number, data: UserUpdate) {
    return await this.prismaService.user.update({
      where: {
        id
      },
      data,
      select: {
        id: true,
        created_at: true,
        email: true,
        is_verified: true,
        verification_token: true,
        nb_incorrect_passwords: true,
        last_sign_in_at: true
      }
    });
  }

  async remove(id: number) {
    return await this.prismaService.user.delete({
      where: {
        id
      }
    });
  }
}
