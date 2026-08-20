# Pictacular

Pictacular is a PWA built with Nuxt/Nitro, designed to display images stored in an AWS bucket.

## Setup

Install the dependencies:

```bash
npm install
```

A `DATABASE_URL` must be set in `.env` (copy from `.env.example`) before installing, since
`prisma generate && prisma db push` runs as part of install.

## Development Server

Start the development server on `https://pictacular.dev:4005` (requires `pictacular.dev` in
`/etc/hosts`):

```bash
npm run dev
```
