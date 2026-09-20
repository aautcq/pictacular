// Derives an isolated database URL for the test suite from NUXT_DATABASE_URL
// by suffixing the database name with `_test` (same host/credentials,
// separate database). Shared by vitest.config.ts (so `npm run test` never
// points at the dev database) and the `pretest` db-push step below.
//
// This exists because e2e specs create real EmailOutbox rows (registration,
// invitation, etc. emails) as a side effect of exercising the app over HTTP.
// Without a dedicated test database, those rows landed in the dev database;
// the next time `npm run dev` was started, Nitro's `email-outbox:process`
// scheduled task picked them up and sent them for real via Brevo using the
// developer's real API key against @example.com test fixtures — a hard-bounce
// storm that got the account's daily send quota blocked.
export function toTestDatabaseUrl(databaseUrl) {
  if (!databaseUrl)
    throw new Error('NUXT_DATABASE_URL must be set (see .env.example)')

  const url = new URL(databaseUrl)
  const dbName = url.pathname.replace(/^\//, '')

  if (!dbName.endsWith('_test'))
    url.pathname = `/${dbName}_test`

  return url.toString()
}
