import type { EmailLang } from './i18n/emails'

import { BrevoClient } from '@getbrevo/brevo'
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
// NestJS MailerService: same ejs HTML template rendering, with
// nestjs-i18n replaced by the minimal t(key, lang) dictionary util.
// The @sendgrid/mail SDK call was swapped for the @getbrevo/brevo SDK
// (issue #134).
export async function sendEmail(data: EmailData, type: EmailType, lang: EmailLang = 'en') {
  const config = useRuntimeConfig()
  const brevo = new BrevoClient({ apiKey: config.brevoApiKey })

  const template = await loadTemplate()

  const html = ejs.render(template, {
    ...data,
    title: t(`${type}.title`, lang),
    content: t(`${type}.content`, lang),
    cta: t(`${type}.cta`, lang),
    alternative: t(`${type}.alternative`, lang),
  })

  await brevo.transactionalEmails.sendTransacEmail({
    sender: { name: 'Pictacular', email: 'pictacular@aautcq.com' },
    to: [{ email: data.email }],
    subject: t(`${type}.subject`, lang),
    htmlContent: html,
  })
}
