import type { AccessToken } from './utils/jwt'

declare module 'h3' {
  interface H3EventContext {
    user?: AccessToken['user']
    session?: AccessToken['session']
  }
}

export {}
