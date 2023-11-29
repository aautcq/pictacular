import { OnModuleInit, Injectable, Global } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import type { Server } from 'socket.io';
import type { PushSubscription } from 'web-push';

@Global()
@WebSocketGateway({
  cors: {
    origin: process.env.CLIENT_URL,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept'
  }
})
@Injectable()
export class GatewayService implements OnModuleInit {
  constructor(private readonly configService: ConfigService) {}

  @WebSocketServer()
  server: Server;

  onModuleInit() {
    this.server.on('connection', (socket) => {
      console.log('New connection', socket.id);
    });
  }

  async sendPushNotification(
    subscription: PushSubscription,
    name: string,
    title: string,
    body: string
  ) {
    const webpushOptions = {
      vapidDetails: {
        subject: this.configService.get<string>('CLIENT_URL'),
        privateKey: this.configService.get<string>('WEB_PUSH_PRIVATE_KEY'),
        publicKey: this.configService.get<string>('WEB_PUSH_PUBLIC_KEY')
      },
      TTL: 60
    };

    const content = JSON.stringify({
      name,
      content: { title, body }
    });

    try {
      const log = await webpush.sendNotification(
        subscription,
        content,
        webpushOptions
      );
      console.log(
        'Push notification sent.',
        subscription,
        content,
        webpushOptions,
        log
      );
    } catch (error) {
      console.log(error);
    }
  }

  sendMessage(room: string, data: unknown) {
    console.log('sending message', room, data);
    this.server.emit(room, data);
  }
}
