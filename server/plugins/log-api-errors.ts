import { getRequestIP, isError } from 'h3'
import { prisma } from '#server/utils/prisma'

// Replaces the former Express errorsHandler middleware: hooks into Nitro's
// global `error` hook (fired once per request for every thrown/handled
// error, from `createError` calls in route handlers as well as uncaught
// exceptions — see h3App's `onError` in nitropack's internal app.mjs) and
// persists it to the ApiError table, without altering the existing
// namespaced error-code response contract (the default Nitro error handler
// still renders the response from the same error object).
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', async (error, { event }) => {
    const h3Error = isError(error) ? error : undefined
    const statusCode = h3Error?.statusCode ?? 500
    const statusMessage = h3Error?.statusMessage

    const user_id = event?.context?.user?.id ?? null
    const user_ip = event ? (getRequestIP(event, { xForwardedFor: true }) ?? null) : null
    const path = event?.path ?? 'unknown'
    const details = h3Error?.data ? JSON.stringify(h3Error.data) : null

    try {
      await prisma.apiError.create({
        data: {
          user_id,
          user_ip,
          type: statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'API',
          path,
          status: statusCode,
          message: statusMessage ?? error.message ?? 'unknown_error',
          details,
          raw: error.stack ?? null,
        },
      })
    }
    catch (loggingError) {
      // Never let error logging itself crash the request/response cycle.
      console.error('[log-api-errors] failed to persist ApiError', loggingError)
    }
  })
})
