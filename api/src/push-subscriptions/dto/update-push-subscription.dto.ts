import { PartialType } from '@nestjs/swagger';
import { CreatePushSubscriptionDto } from '@/push-subscriptions/dto/create-push-subscription.dto';

export class UpdatePushSubscriptionDto extends PartialType(
  CreatePushSubscriptionDto
) {}
