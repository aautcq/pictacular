// https://nuxt.com/docs/api/configuration/nuxt-config
import tailwindcss from '@tailwindcss/vite'

const appName = 'Pictacular'
const description = 'Pictacular is an image gallery app'
const image
  = 'https://pictacular.s3.eu-west-3.amazonaws.com/android-chrome-192x192.png'

export default defineNuxtConfig({
  devtools: { enabled: true },
  modules: [
    '@nuxt/icon',
    '@vite-pwa/nuxt',
    '@nuxt/fonts',
    'nuxt-security',
    '@nuxtjs/color-mode',
    '@nuxtjs/i18n',
  ],
  css: ['~/assets/css/tailwind.css'],
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
      title: appName,
      base: { href: '/' },
      link: [
        {
          rel: 'apple-touch-icon',
          type: 'image/png',
          sizes: '180x180',
          href: '/apple-touch-icon.png',
        },
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '32x32',
          href: '/favicon-32x32.png',
        },
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '16x16',
          href: '/favicon-16x16.png',
        },
        {
          rel: 'mask-icon',
          color: '#0c0a09',
          href: '/safari-pinned-tab.svg',
        },
      ],
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'fragment', content: '!' },
        { name: 'description', content: description },
        { name: 'og:description', content: description },
        { name: 'og:title', content: appName },
        { name: 'og:type', content: 'website' },
        { name: 'og:site_name', content: appName },
        { name: 'og:image', content: image },
        { name: 'og:image:url', content: image },
      ],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
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
        'img-src': ['\'self\'', 'https://*.s3.amazonaws.com', 'https://*.s3.*.amazonaws.com'],
      },
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
})
