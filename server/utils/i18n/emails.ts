import en from './emails/en.json'
import fr from './emails/fr.json'

export type EmailLang = 'en' | 'fr'

const dictionaries: Record<EmailLang, typeof en> = { en, fr }

// Minimal custom email-i18n utility, replacing `nestjs-i18n`. Scoped only to
// the email templates (dictionaries ported from the former
// api/src/i18n/{en,fr}/emails.json) — this is not a general-purpose
// frontend/backend i18n layer, since the API error contract already returns
// namespaced string codes for the frontend to translate itself.
export function t(key: string, lang: string | undefined): string {
  const dictionary = dictionaries[lang as EmailLang] ?? dictionaries.en

  const value = key
    .split('.')
    .reduce<unknown>(
      (node, segment) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[segment] : undefined),
      dictionary,
    )

  return typeof value === 'string' ? value : key
}
