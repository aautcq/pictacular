import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/prisma/prisma.service';
import type { PushSubscriptionCreate } from '@/push-subscriptions/entities/push-subscription.entity';

@Injectable()
export class PushSubscriptionsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(user_id: string, data: PushSubscriptionCreate) {
    return await this.prismaService.pushSubscription.create({
      data: {
        endpoint: data.endpoint,
        keys: data.keys,
        user: {
          connect: {
            id: user_id
          }
        }
      },
      select: {
        id: true
      }
    });
  }

  async findAllFromUser(user_id: string) {
    return await this.prismaService.pushSubscription.findMany({
      where: {
        user_id
      },
      select: {
        id: true,
        endpoint: true,
        keys: true
      }
    });
  }
}
