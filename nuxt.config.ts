import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'

const appName = 'Pictacular'
const description = 'Pictacular is an image gallery app'

export default defineNuxtConfig({
  devtools: { enabled: true },

  // shared/utils/validation nests the zod schemas one level below
  // shared/utils/ (grouped by domain, mirroring the former
  // server/utils/validation/ layout — see ADR 0004), so it needs an
  // explicit opt-in: Nuxt's shared/ auto-import only covers shared/utils/
  // and shared/types/ themselves, not their subdirectories. `imports.dirs`
  // entries resolve relative to `srcDir` (`app/`), hence the `../`.
  imports: {
    dirs: ['../shared/utils/validation'],
  },

  modules: [
    '@nuxt/icon',
    '@nuxt/image',
    '@vite-pwa/nuxt',
    '@nuxt/fonts',
    'nuxt-security',
    '@nuxt/ui',
    '@nuxtjs/i18n',
    '@vueuse/nuxt',
    '@nuxtjs/seo',
  ],

  css: ['~/assets/css/main.css'],

  // Photos/covers are served through this app's own stable per-Photo
  // image endpoints (issue #168, server/api/photos/[id]/image.get.ts and
  // its Public Share Link counterpart) rather than raw presigned S3 URLs,
  // so every image source is same-origin. These endpoints need the
  // viewer's own session cookie to authorize the read, which the default
  // `ipx` provider's server-side fetch can't carry (it either reads a
  // literal file from `public/`, or fetches an allow-listed absolute URL
  // with no request context) — so Photo `<NuxtImg>`s use the `photo`
  // provider below instead, which resizes in the route itself (see
  // server/utils/photo-image-resize.ts) via plain query params on an
  // ordinary same-origin request. `format`/`quality` stay as this
  // module's own defaults, applied by that same resize helper.
  image: {
    format: ['webp'],
    quality: 80,
    providers: {
      photo: {
        name: 'photo',
        provider: '~/providers/photo.ts',
      },
    },
  },

  vite: {
    plugins: [
      tailwindcss(),
    ],
  },

  fonts: {
    families: [
      { name: 'Mulish', provider: 'google', global: true },
    ],
  },

  colorMode: {
    classSuffix: '',
  },

  // English-only for now (ADR 0002): no URL locale prefix, active locale
  // persisted in a cookie (not localStorage) so SSR renders the correct
  // locale on first paint, consistent with the app's cookie-based JWT auth.
  // Navigator-based redirects are unnecessary with a single locale (nothing
  // to negotiate) so `redirectOn` is left at its default, moot under
  // `strategy: 'no_prefix'` anyway since there's no URL to redirect to.
  i18n: {
    restructureDir: 'app/i18n',
    locales: [{ code: 'en', name: 'English' }],
    defaultLocale: 'en',
    strategy: 'no_prefix',
    detectBrowserLanguage: {
      useCookie: true,
    },
    bundle: {
      runtimeOnly: true,
    },
  },

  app: {
    head: {
      base: { href: '/' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'fragment', content: '!' },
      ],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
  },

  site: {
    url: 'https://pictacular.com',
    name: appName,
    description: 'See Adrien Autricque\'s portfolio, a web developer based in Lille, France.',
    indexable: true,
  },
  seo: {
    enabled: true,
  },

  robots: {
    allow: '/',
  },

  schemaOrg: {
    identity: {
      type: 'Person',
      name: appName,
      url: 'https://pictacular.com',
      logo: 'https://pictacular.com/logo.png',
    },
  },

  linkChecker: {
    failOnError: true, // Fails build if broken links are found
    report: {
      html: true,
      markdown: true,
    },
  },

  pwa: {
    registerType: 'autoUpdate',
    workbox: {
      globPatterns: ['**/*.{js,ts,css,html}'],
      sourcemap: true,
      // importScripts: ['/push-notifications-sw.js'],
    },
    devOptions: {
      enabled: false,
    },
    manifest: {
      name: appName,
      short_name: appName,
      description,
      theme_color: '#49de80',
      background_color: '#0f172a',
      start_url: '/',
      display: 'standalone',
      display_override: ['window-controls-overlay'],
      icons: [
        {
          src: '/android-chrome-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/android-chrome-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    },
  },
  security: {
    headers: {
      contentSecurityPolicy: {
        // Photos/avatars used to be served from each User's own Storage
        // Connection bucket directly (any bucket name/region, per ADR
        // 0001), requiring a wildcard here. Photos now proxy through this
        // app's own stable image endpoints (issue #168), so only avatars
        // (server/utils/serialize-user.ts, unaffected by that change)
        // still load a raw signed S3 URL client-side — hence the
        // wildcard staying put.
        'img-src': ['\'self\'', 'data:', 'https://*.s3.amazonaws.com', 'https://*.s3.eu-west-3.amazonaws.com', ...(process.env.AWS_S3_ENDPOINT ? [process.env.AWS_S3_ENDPOINT] : [])],
      },
    },
  },

  // Photo images now proxy through this app's own routes (issue #168)
  // instead of being fetched by the browser directly from S3, so a
  // single gallery page load can issue dozens of image requests against
  // this server. nuxt-security's default rateLimiter (150 req/5min) is a
  // single shared per-IP bucket across every route, so those image
  // requests were exhausting the same budget as regular API calls and
  // causing 429s on unrelated endpoints (e.g. GET /api/albums/:id).
  // Give the image routes their own, much higher budget instead of
  // disabling rate limiting for them entirely.
  //
  // Nitro's routeRules matcher (radix3) only supports "**" as a
  // trailing catch-all, not mid-path (e.g. '/api/photos/**/image' never
  // matches anything), so this has to scope to the whole '/api/photos/**'
  // and '/api/albums/public/**' prefixes rather than the image routes
  // alone. Every route under those prefixes is already
  // authenticated/authorized per-Photo or per-share-token, so the wider
  // budget is safe to share with them too.
  routeRules: {
    '/api/photos/**': {
      security: {
        rateLimiter: {
          tokensPerInterval: 2000,
          interval: 300000,
        },
      },
    },
    '/api/albums/public/**': {
      security: {
        rateLimiter: {
          tokensPerInterval: 2000,
          interval: 300000,
        },
      },
    },
  },
  icon: {
    clientBundle: {
      scan: true,
      sizeLimitKb: 256,
    },
  },
  nitro: {
    imports: {
      // shared/utils/validation nests the zod schemas one level below
      // shared/utils/ (see the `imports` config above for why that needs
      // an explicit opt-in on the server side too — Nitro's own
      // shared/utils/ auto-import is likewise non-recursive).
      dirs: ['shared/utils/validation'],
    },
    experimental: {
      websocket: true,
      // Enables auto-scanning of server/tasks/**, required for the
      // outbox retry/purge scheduled task (issue #97).
      tasks: true,
    },
    // Nitro's own scheduled-task runner (croner-backed) already no-ops
    // under `std-env`'s `isTest` (NODE_ENV=test, as `@nuxt/test-utils`
    // boots the server under in e2e specs), so no extra env guard is
    // needed here for the "must not run in the test environment"
    // requirement (issue #97).
    scheduledTasks: {
      '* * * * *': ['email-outbox:process'],
      // 15-30 min cadence is more than adequate: a Restore Request itself
      // takes hours, so there's no benefit to polling more aggressively
      // (issue #145 / ADR 0005).
      '*/15 * * * *': ['archived-photos:scan'],
    },
  },
  runtimeConfig: {
    cookieDomain: '',
    databaseUrl: '',
    brevoApiKey: '',
    jwt: {
      publicKey: '',
      privateKey: '',
    },
    webPush: {
      publicKey: '',
      privateKey: '',
    },
  },
  compatibilityDate: '2026-08-22',
})
