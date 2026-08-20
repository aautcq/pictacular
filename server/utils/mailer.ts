import type { EmailLang } from './i18n/emails'

import process from 'node:process'
import sgMail from '@sendgrid/mail'
// ejs 6's ESM build only exposes a default export (no named `render`
// export), unlike the CJS build's exports object — so we import the
// default and pull `render` off it instead of a named import.
import ejs from 'ejs'
import { t } from './i18n/emails'

export type EmailType = 'verification' | 'password-reset' | 'invitation'

export interface EmailData {
  email: string
  link: string
}

let templatePromise: Promise<string> | null = null

// The compiled EJS template is a server asset (server/assets/emails/), read
// once and cached, so it survives the Nitro build the same way it did as a
// plain `readFileSync` in the former NestJS MailerService.
function loadTemplate() {
  templatePromise ??= useStorage('assets:server')
    .getItem<string>('emails:template.html.ejs')
    .then((content) => {
      if (!content)
        throw new Error('Missing emails/template.html.ejs server asset')
      return content
    })

  return templatePromise
}

// Plain mailer utility (no DI container), ported from the former
// NestJS MailerService: same @sendgrid/mail SDK call and ejs HTML template,
// with nestjs-i18n replaced by the minimal t(key, lang) dictionary util.
export async function sendEmail(data: EmailData, type: EmailType, lang: EmailLang = 'en') {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? '')

  const template = await loadTemplate()

  const html = ejs.render(template, {
    ...data,
    title: t(`${type}.title`, lang),
    content: t(`${type}.content`, lang),
    cta: t(`${type}.cta`, lang),
    alternative: t(`${type}.alternative`, lang),
  })

  await sgMail.send({
    from: 'Pictacular <pictacular@aautcq.com>',
    to: data.email,
    subject: t(`${type}.subject`, lang),
    html,
  })
}
