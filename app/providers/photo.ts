import { createOperationsGenerator, defineProvider } from '@nuxt/image/runtime'

// Custom @nuxt/image provider for Photo images (issue #168): the default
// `ipx` provider can only resize images it can reach as either a real file
// under `public/` or an absolute URL on an allow-listed domain fetched
// with no request context — neither works for our authenticated,
// same-origin `/api/photos/[id]/image` (and public share-link) routes,
// which need the viewer's own cookies to authorize the read. So instead
// of `/_ipx/...`, this provider points `NuxtImg` straight at those routes
// with plain `width`/`height`/`fit`/`format` query params, which the
// route itself resizes (see server/utils/photo-image-resize.ts) — a
// normal same-origin request, cookies included, no extra network hop.
const operationsGenerator = createOperationsGenerator()

export default defineProvider({
  getImage(src, { modifiers }) {
    const operations = operationsGenerator(modifiers ?? {})

    return {
      url: operations ? `${src}?${operations}` : src,
    }
  },
})
