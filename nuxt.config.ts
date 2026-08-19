// https://nuxt.com/docs/api/configuration/nuxt-config

const appName = 'Pictacular'
const description = 'Pictacular is an image gallery app'
const image
  = 'https://pictacular.s3.eu-west-3.amazonaws.com/android-chrome-192x192.png'

export default defineNuxtConfig({
  devtools: { enabled: true },
  devServer: {
    host: 'pictacular.dev',
    port: 4005,
    https: { key: './server.key', cert: './server.crt' },
  },
  modules: [
    '@nuxtjs/tailwindcss',
    'nuxt-icon',
    '@vite-pwa/nuxt',
    '@nuxtjs/fontaine',
    'nuxt-security',
  ],
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
        'img-src': ['\'self\'', 'https://pictacular.s3.eu-west-3.amazonaws.com'],
      },
    },
  },
  nitro: {
    experimental: {
      websocket: true,
    },
  },
})
