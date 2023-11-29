import { Controller, Post, Body, UseGuards, Res } from '@nestjs/common';
import { PushSubscriptionsService } from '@/push-subscriptions/push-subscriptions.service';
import { AuthGuard } from '@/common/guards/auth.guard';
import type { Response } from 'express';
import type { CreatePushSubscriptionDto } from '@/push-subscriptions/dto/create-push-subscription.dto';

@Controller('push-subscriptions')
export class PushSubscriptionsController {
  constructor(
    private readonly pushSubscriptionsService: PushSubscriptionsService
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  async create(
    @Res() response: Response,
    @Body() createPushSubscriptionDto: CreatePushSubscriptionDto
  ) {
    const id = response.locals.user.id;
    const subsciption = JSON.parse(createPushSubscriptionDto.subscription);
    console.log(subsciption);
    await this.pushSubscriptionsService.create(id, {
      endpoint: subsciption.endpoint,
      keys: JSON.stringify({
        auth: subsciption.keys.auth,
        p256dh: subsciption.keys.p256dh
      })
    });
    response.status(204).send();
  }
}
