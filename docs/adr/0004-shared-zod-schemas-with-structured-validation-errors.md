# Share zod validation schemas between server and client; forward structured field errors

Status: accepted

Validation schemas (`server/utils/validation/*.ts`) move to `shared/utils/validation/*.ts`
so both `server/api/**` handlers and `app/**` forms validate against the exact same zod
schema — no risk of client and server validation drifting apart. Every body-validating
mutation endpoint (POST/PATCH under `server/api/**`, excluding GET query validation)
returns a single generic `validation.invalid_payload` error code with the per-field
detail carried in `data.errors: { name, message }[]` (the shape `UForm#setErrors` expects
directly), instead of a domain-namespaced code per endpoint. Frontend forms bind
`<UForm :schema>` to the shared schema for immediate client-side validation, and keep a
`data.errors` → `setErrors` fallback for defense-in-depth against client/server schema
drift (e.g. a mid-deploy race between two tabs).

## Considered Options

- Per-domain namespaced invalid-payload codes (`auth.invalid_payload`,
  `photos.invalid_payload`, ...) — rejected: the top-level code is never shown to the
  user (per-field messages live in `data.errors`), so namespacing it just duplicates
  translation-file entries for zero benefit.
- Client-side-only validation (drop server-side field errors once `UForm:schema` exists)
  — rejected: server-side validation must stay authoritative regardless (never trust the
  client), and the structured-error fallback is what keeps a schema-drift bug from
  surfacing as a raw, unhelpful toast.

## Consequences

- Endpoints without a matching `<UForm>` (WebAuthn registration/verification, avatar and
  photo uploads which build their payload from a `FileReader`, and endpoints with no
  frontend caller yet) still return the structured `data.errors` shape for consistency,
  even though nothing consumes it via `setErrors` today.
- A few existing forms need their local `state` reshaped to match the shared schema
  field-for-field (e.g. `password_confirmation` instead of camelCase, `emails: string[]`
  instead of a delimited string) before `:schema` can bind directly.
- `login.vue` disables `UForm`'s default blur/input schema validation
  (`:validate-on="[]"`, submit-time validation still runs) because its "sign in with
  biometrics" button blurs the autofocused email field on click, and that blur-triggered
  async validation was observed to consume the click's WebAuthn user-activation gesture,
  silently breaking `navigator.credentials.get()`.
