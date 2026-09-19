#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { toTestDatabaseUrl } from './test-database-url.mjs'
import 'dotenv/config'

// Runs `prisma db push` against the isolated test database (see
// test-database-url.mjs) so `npm run test` always exercises an up-to-date
// schema without ever touching the dev database. Wired as the `pretest`
// npm script.
const testDatabaseUrl = toTestDatabaseUrl(process.env.NUXT_DATABASE_URL)

const result = spawnSync('npx', ['prisma', 'db', 'push', '--url', testDatabaseUrl], {
  stdio: 'inherit',
  env: process.env,
})

process.exit(result.status ?? 1)
