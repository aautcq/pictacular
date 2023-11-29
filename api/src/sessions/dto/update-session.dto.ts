import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateSessionDto {
  @IsNotEmpty()
  @IsString()
  user_agent: string;
}
