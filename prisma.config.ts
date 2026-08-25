import { defineConfig, env } from 'prisma/config'
import 'dotenv/config'

// Prisma ORM v7 no longer loads .env files or reads datasource url/schema
// path from schema.prisma by default for CLI operations (generate, db push,
// etc.) — this replaces that configuration.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('NUXT_DATABASE_URL'),
  },
})
