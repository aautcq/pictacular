import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nContext, I18nService } from 'nestjs-i18n';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render } from 'ejs';
import * as sgMail from '@sendgrid/mail';

export type EmailType = 'verification' | 'password-reset' | 'answers-due';

export type EmailData = Partial<{
  email: string;
  name: string;
  link: string;
}>;

@Injectable()
export class MailerService {
  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService
  ) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    sgMail.setApiKey(apiKey);
  }

  async sendEmail(data: EmailData, type: EmailType) {
    const filename = join(__dirname, 'emails/template.html.ejs');
    const template = readFileSync(filename, { encoding: 'utf-8' });
    if (!template || !data.email) return;

    const lang = I18nContext?.current?.()?.lang ?? 'en';

    const content = render(template, {
      ...data,
      title: this.i18n.t(`emails.${type}.title`, { lang }),
      content: this.i18n.t(`emails.${type}.content`, { lang }),
      cta: this.i18n.t(`emails.${type}.cta`, { lang }),
      alternative: this.i18n.t(`emails.${type}.alternative`, { lang })
    });

    await sgMail.send({
      from: 'Pictacular <pictacular@aautcq.com>',
      to: data.email,
      subject: this.i18n.t(`emails.${type}.subject`, { lang }),
      html: content
    });
  }
}
