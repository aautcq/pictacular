import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class CronService {
  constructor(private readonly configService: ConfigService) {}

  // every 14 minutes
  @Cron('*/14 * * * *')
  async renderPing() {
    const apiUri = this.configService.get<string>('API_URI');
    const clientUri = this.configService.get<string>('CLIENT_URL');
    await axios.get(`${apiUri}/`);
    await axios.get(`${clientUri}/render-ping`);
    console.log('Cron job renderPing');
  }
}
