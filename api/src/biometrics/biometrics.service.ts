import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/config/prisma/prisma.service';

@Injectable()
export class BiometricsService {
  constructor(private readonly prismaService: PrismaService) {}

  async create(
    user_id: string,
    credential_id: string,
    pem: string,
    counter: number
  ) {
    return await this.prismaService.biometrics.create({
      data: {
        credential_id,
        pem,
        counter,
        user: {
          connect: {
            id: user_id
          }
        }
      },
      select: {
        id: true,
        created_at: false,
        updated_at: false,
        credential_id: false,
        pem: false,
        counter: false,
        user_id: false
      }
    });
  }

  async findByCredentialId(credential_id: string) {
    return await this.prismaService.biometrics.findFirst({
      where: {
        credential_id
      },
      select: {
        id: true,
        created_at: false,
        updated_at: false,
        credential_id: true,
        pem: true,
        counter: true,
        user_id: true,
        user: {
          select: {
            id: true,
            email: true,
            created_at: true
          }
        }
      }
    });
  }

  async updateCounter(id: string, value: number) {
    return await this.prismaService.biometrics.update({
      where: { id },
      data: {
        counter: value
      },
      select: {
        id: true
      }
    });
  }
}
