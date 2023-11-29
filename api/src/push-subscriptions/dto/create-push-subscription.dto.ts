import { IsNotEmpty, IsString } from 'class-validator';

export class CreatePushSubscriptionDto {
  @IsNotEmpty()
  @IsString()
  subscription: string;
}
