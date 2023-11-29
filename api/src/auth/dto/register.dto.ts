import { IsEqualTo } from '@/common/decorators/isEqualTo.decorator';
import { ValidatePasswordComplexity } from '@/common/decorators/validatePasswordComplexity.decorator';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @ValidatePasswordComplexity(3)
  password: string;

  @IsString()
  @IsNotEmpty()
  @IsEqualTo('password', {
    message: 'password_confirmation and password must match'
  })
  password_confirmation: string;
}
