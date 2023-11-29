import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/prisma/prisma.service';

import type {
  UserCreate,
  UserUpdate,
  UserFindUnique
} from '@/users/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  private async getFreshToken() {
    let token = '';
    do {
      token =
        Math.random().toString(36).substring(2) +
        Math.random().toString(36).substring(2);
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
      where: data,
      select: {
        id: true,
        created_at: true,
        email: true,
        is_verified: true,
        verification_token: true,
        last_sign_in_at: true,
        nb_incorrect_passwords: true,
        password
      }
    });
  }

  async findWithFlashcards() {
    return await this.prismaService.user.findMany({
      where: {
        is_verified: true,
        NOT: {
          OR: [{ flashcards: { none: {} } }, { notificationsSettings: null }]
        }
      },
      select: {
        id: true,
        email: true,
        notificationsSettings: {
          select: {
            id: true,
            is_email_active: true,
            is_push_active: true,
            is_sent: true,
            hour: true,
            minute: true,
            updates: true
          }
        }
      }
    });
  }

  async findAll() {
    return await this.prismaService.user.findMany({
      where: {
        is_verified: true,
        NOT: {
          notificationsSettings: null
        }
      },
      select: {
        id: true,
        notificationsSettings: {
          select: {
            id: true,
            is_email_active: true,
            is_push_active: true,
            is_sent: true
          }
        }
      }
    });
  }

  async update(id: string, data: UserUpdate) {
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

  async remove(id: string) {
    return await this.prismaService.user.delete({
      where: {
        id
      }
    });
  }
}
