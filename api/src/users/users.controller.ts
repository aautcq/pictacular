import {
  Controller,
  Res,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards
} from '@nestjs/common';
import { UsersService } from '@/users/users.service';
import { AuthGuard } from '@/common/guards/auth.guard';
import {
  accessTokenCookieOptions,
  refreshTokenCookieOptions
} from '@/auth/cookies.params';
import type { UpdateUserDto } from '@/users/dto/update-user.dto';
import type { Response } from 'express';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(AuthGuard)
  @Get('/me')
  async findOne(@Res() response: Response) {
    const id = response.locals.user.id;
    const data = await this.usersService.findUnique({ id });
    response.status(200).json({
      id: data.id,
      email: data.email,
      created_at: data.created_at,
      last_sign_in_at: data.last_sign_in_at
    });
  }

  @UseGuards(AuthGuard)
  @Patch(':id')
  async update(@Param('id') id: number, @Body() updateUserDto: UpdateUserDto) {
    return await this.usersService.update(id, updateUserDto);
  }

  @UseGuards(AuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: number, @Res() response: Response) {
    await this.usersService.remove(id);
    response.clearCookie('pictacularAccTok', accessTokenCookieOptions);
    response.clearCookie('pictacularRefTok', refreshTokenCookieOptions);
    response.status(204).send();
  }
}
