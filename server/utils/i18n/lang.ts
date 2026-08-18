import type { H3Event } from 'h3'
import type { EmailLang } from './emails'

const supportedLangs: EmailLang[] = ['en', 'fr']

// Minimal replacement for nestjs-i18n's AcceptLanguageResolver: reads the
// first supported language out of the Accept-Language header, falling back
// to English.
export function getPreferredLang(event: H3Event): EmailLang {
  const header = getRequestHeader(event, 'accept-language')
  if (!header)
    return 'en'

  const requestedLangs = header
    .split(',')
    .map(part => part.split(';')[0]?.trim().slice(0, 2).toLowerCase())

  return requestedLangs.find((lang): lang is EmailLang =>
    supportedLangs.includes(lang as EmailLang)) ?? 'en'
}
