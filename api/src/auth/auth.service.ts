import { CryptoService } from '@/config/crypto/crypto.service';
import { PrismaService } from '@/config/prisma/prisma.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { User, UserSetPassword } from '@/users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly cryptoService: CryptoService
  ) {}

  private async getFreshToken() {
    let token = '';
    do {
      token = this.cryptoService.generateRandomString(32);
    } while (
      await this.prismaService.resetPasswordToken.findFirst({
        where: { token }
      })
    );
    return token;
  }

  async generateResetPasswordToken(email: User['email']) {
    const token = await this.getFreshToken();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    const resetPasswordToken =
      await this.prismaService.resetPasswordToken.create({
        data: {
          token,
          expiresAt: expiresAt,
          user: { connect: { email } }
        }
      });

    await this.prismaService.resetPasswordToken.updateMany({
      where: {
        user: { email },
        NOT: { id: resetPasswordToken.id }
      },
      data: {
        expired: true
      }
    });

    return token;
  }

  async setNewPassword(data: UserSetPassword, token: string) {
    const { password } = data;
    const resetPasswordToken =
      await this.prismaService.resetPasswordToken.findFirst({
        where: {
          token,
          expiresAt: { gte: new Date() },
          expired: false
        },
        select: {
          id: true,
          token: true,
          user: { select: { id: true } }
        }
      });
    if (!resetPasswordToken) throw new UnauthorizedException('invalid_token');

    const passwordHash = this.cryptoService.hash(password);
    await this.prismaService.user.update({
      where: {
        id: resetPasswordToken.user.id
      },
      data: { password: passwordHash, nb_incorrect_passwords: 0 }
    });

    await this.prismaService.resetPasswordToken.update({
      where: { id: resetPasswordToken.id },
      data: { expired: true }
    });
  }
}
