import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from '@/users/dto/create-user.dto';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @IsNotEmpty()
  @IsString()
  id: string;
}
