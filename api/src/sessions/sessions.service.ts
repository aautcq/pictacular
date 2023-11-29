import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/prisma/prisma.service';

import type {
  SessionCreate,
  SessionFindUnique,
  SessionUpdate,
  SessionRevokeAllExceptOne
} from '@/sessions/entities/session.entity';

@Injectable()
export class SessionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(data: SessionCreate) {
    const session = await this.prismaService.session.create({
      data: {
        active: data.active,
        user_agent: data.user_agent,
        user: {
          connect: {
            id: data.user_id
          }
        }
      }
    });
    return session;
  }

  async findUnique(data: SessionFindUnique) {
    const session = await this.prismaService.session.findUnique({
      where: data
    });
    return session;
  }

  async update(data: SessionUpdate) {
    const { id, ...rest } = data;
    const session = await this.prismaService.session.update({
      where: {
        id
      },
      data: rest
    });
    return session;
  }

  async revokeAllExceptOne(data: SessionRevokeAllExceptOne) {
    await this.prismaService.session.updateMany({
      where: {
        user_id: data.user_id,
        active: true,
        NOT: {
          id: data.id
        }
      },
      data: {
        active: false,
        refresh_token: null
      }
    });
    return;
  }
}
