import tailwindcss from '@tailwindcss/vite'

const appName = 'Pictacular'
const description = 'Pictacular is an image gallery app'

export default defineNuxtConfig({
  devtools: { enabled: true },

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
        // Every User's Photos/avatar are served from their own Storage
        // Connection bucket (any bucket name/region, per ADR 0001), not a
        // single fixed host — a wildcard is required so signed image URLs
        // from any User's bucket can load.
        'img-src': ['\'self\'', 'data:', 'https://*.s3.amazonaws.com', 'https://*.s3.eu-west-3.amazonaws.com'],
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
    },
  },
  runtimeConfig: {
    cookieDomain: '',
    databaseUrl: '',
    sendgridApiKey: '',
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
