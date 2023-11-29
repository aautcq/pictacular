import { IsNotEmpty, IsString } from 'class-validator';

export class CreateSessionDto {
  @IsNotEmpty()
  @IsString()
  user_agent: string;
}
