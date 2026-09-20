import process from 'node:process'

export interface GoogleUserinfo {
  sub: string
  email: string
  email_verified: boolean
  name?: string
}

// Base host for Google's own OAuth/OpenID endpoints, overridable via
// GOOGLE_OAUTH_ENDPOINT — mirroring AWS_S3_ENDPOINT's role for the fake S3
// double (server/utils/storage.ts) — so black-box tests can point this
// hand-rolled authorization-code flow at an in-process fake Google server
// (test/e2e/fake-google-oauth-server.ts) instead of the real
// accounts.google.com/oauth2.googleapis.com/openidconnect.googleapis.com
// hosts. Read directly from `process.env` (not runtimeConfig) so a test
// file can set it before `setup()` boots the app, the same accommodation
// AWS_S3_ENDPOINT already relies on.
function endpoint(defaultOrigin: string, path: string): string {
  const base = process.env.GOOGLE_OAUTH_ENDPOINT || defaultOrigin
  return `${base}${path}`
}

function googleAuthorizationEndpoint(): string {
  return endpoint('https://accounts.google.com', '/o/oauth2/v2/auth')
}

function googleTokenEndpoint(): string {
  return endpoint('https://oauth2.googleapis.com', '/token')
}

function googleUserinfoEndpoint(): string {
  return endpoint('https://openidconnect.googleapis.com', '/v1/userinfo')
}

// Builds the URL GET /api/auth/google redirects the browser to, carrying
// the CSRF `state` value the callback later checks against
// oauthStateCookieName (server/utils/cookies.ts), and requesting just
// enough scope (openid + the email/profile claims this feature actually
// reads) to identify the person, never any Google API access beyond that.
export function buildGoogleAuthorizationUrl(state: string, redirectUri: string): string {
  const config = useRuntimeConfig()
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  })

  return `${googleAuthorizationEndpoint()}?${params.toString()}`
}

// Exchanges the authorization `code` GET /api/auth/google/callback
// received for an access token — used only to call the userinfo endpoint
// below, then discarded (ADR-0007: never persisted).
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<string> {
  const config = useRuntimeConfig()
  const response = await $fetch<{ access_token: string }>(googleTokenEndpoint(), {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  return response.access_token
}

export async function fetchGoogleUserinfo(accessToken: string): Promise<GoogleUserinfo> {
  return await $fetch<GoogleUserinfo>(googleUserinfoEndpoint(), {
    headers: { authorization: `Bearer ${accessToken}` },
  })
}

// Name fallback (issue #157): Google's identity data doesn't reliably
// provide separate given/family names, so this splits the single `name`
// claim on its first space instead of trusting given_name/family_name.
// With no space at all, the whole string becomes first_name and
// last_name is an empty string — this must never block account creation.
export function splitGoogleName(name: string): { first_name: string, last_name: string } {
  const spaceIndex = name.indexOf(' ')
  if (spaceIndex === -1)
    return { first_name: name, last_name: '' }

  return { first_name: name.slice(0, spaceIndex), last_name: name.slice(spaceIndex + 1) }
}
