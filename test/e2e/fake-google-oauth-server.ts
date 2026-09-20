import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

// A minimal in-process "virtual Google" standing in for the real Google
// OAuth token/userinfo endpoints in black-box HTTP tests (issue #157), in
// the same spirit as test/e2e/fake-s3-server.ts: implements just enough of
// Google's authorization-code flow — `POST /token` and `GET /userinfo` —
// for server/utils/google-oauth.ts (pointed here via GOOGLE_OAUTH_ENDPOINT)
// to complete a real exchange against, without mocking any of this app's
// own modules. The authorization endpoint itself (`GET /o/oauth2/v2/auth`)
// is never hit in tests — specs call GET /api/auth/google/callback
// directly with a pre-seeded `code`, standing in for the browser's
// redirect back from Google's real consent screen.
export interface GoogleIdentity {
  sub: string
  email: string
  email_verified: boolean
  name?: string
}

export interface FakeGoogleOAuthServer {
  url: string
  // Registers the identity a subsequent POST /token + GET /userinfo pair
  // should resolve to, keyed by the authorization `code` a test crafts for
  // GET /api/auth/google/callback?code=<code>&state=<state>.
  seedIdentity: (code: string, identity: GoogleIdentity) => void
  close: () => Promise<void>
}

export async function startFakeGoogleOAuthServer(): Promise<FakeGoogleOAuthServer> {
  const identitiesByCode = new Map<string, GoogleIdentity>()
  const identitiesByAccessToken = new Map<string, GoogleIdentity>()

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'POST' && url.pathname === '/token') {
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        const params = new URLSearchParams(body)
        const code = params.get('code')
        const identity = code ? identitiesByCode.get(code) : undefined

        if (!identity) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Malformed auth code.' }))
          return
        }

        const accessToken = randomUUID()
        identitiesByAccessToken.set(accessToken, identity)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600 }))
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/v1/userinfo') {
      const accessToken = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
      const identity = accessToken ? identitiesByAccessToken.get(accessToken) : undefined

      if (!identity) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid_token' }))
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(identity))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not_found' }))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    seedIdentity: (code, identity) => identitiesByCode.set(code, identity),
    close: () => new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()))
    }),
  }
}
