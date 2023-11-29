import { IsNotEmpty, IsString } from 'class-validator';

export class UpdatePushSubscriptionDto {
  @IsNotEmpty()
  @IsString()
  subscription: string;
}
