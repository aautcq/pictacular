<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { login, loginWithBiometrics } = useCurrentUser()
const { hasStoredCredential, isSupported } = useBiometrics()
const toast = useToast()
const { translateError, getFieldErrors } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })
const route = useRoute()

const form = useTemplateRef('form')
const email = shallowRef('')
const password = shallowRef('')
const loading = shallowRef(false)
const biometricLoading = shallowRef(false)
// Only one sign-in ceremony may be in flight at a time: both `login` and
// `loginWithBiometrics` create a new Session and revoke the User's other
// active sessions server-side, so letting the password form and the
// automatic/manual biometric attempt race would issue two competing
// sessions and navigate twice.
const anyLoading = computed(() => loading.value || biometricLoading.value)

async function redirectAfterSignIn() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await navigateTo(redirect)
}

async function submit() {
  if (anyLoading.value)
    return

  loading.value = true
  try {
    await login(email.value, password.value)
    toast.add({ title: t('welcomeBack') })
    await redirectAfterSignIn()
  }
  catch (error) {
    form.value?.setErrors(getFieldErrors(error))
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

// Fires automatically on mount when a credential-id cookie is present (a
// prior registration on this device), and can also be triggered manually
// via the "sign in with biometrics" button. The automatic attempt fails
// silently (e.g. the User dismisses the device prompt) so it simply falls
// back to the password form below.
async function signInWithBiometrics({ silent = false } = {}) {
  if (anyLoading.value)
    return

  biometricLoading.value = true
  try {
    await loginWithBiometrics()
    toast.add({ title: t('welcomeBack') })
    await redirectAfterSignIn()
  }
  catch (error) {
    if (!silent)
      toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    biometricLoading.value = false
  }
}

if (isSupported && hasStoredCredential.value)
  signInWithBiometrics({ silent: true })
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <!-- validate-on disabled for blur/input/change (default also validates
    on those): this page also has a "sign in with biometrics" button whose
    click blurs the autofocused email input, and that blur-triggered async
    schema validation was observed to consume the click's WebAuthn
    user-activation gesture, silently breaking navigator.credentials.get().
    Submit-time validation is unaffected by this prop and still runs. -->
    <UForm
      ref="form"
      class="space-y-4"
      :schema="loginSchema"
      :state="{ email, password }"
      :validate-on="[]"
      @submit.prevent="submit"
    >
      <UFormField :label="t('emailLabel')" name="email">
        <UInput
          v-model="email"
          type="email"
          required
          autocomplete="email"
          :placeholder="t('emailPlaceholder')"
          autofocus
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('passwordLabel')" name="password">
        <BasePasswordInput
          v-model="password"
          required
          autocomplete="current-password"
          :placeholder="t('passwordPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <div class="flex justify-end">
        <NuxtLink to="/forgot-password" class="text-sm underline">
          {{ t('forgotPassword') }}
        </NuxtLink>
      </div>

      <UButton
        type="submit"
        :disabled="anyLoading"
        :loading="loading"
        block
        :label="loading ? t('signingIn') : tg('common.nav.signIn')"
      />

      <UButton
        v-if="isSupported"
        type="button"
        block
        color="neutral"
        variant="soft"
        :disabled="anyLoading"
        :loading="biometricLoading"
        :label="biometricLoading ? t('signingIn') : t('signInWithBiometrics')"
        @click="signInWithBiometrics()"
      />

      <p class="text-center text-sm">
        {{ t('noAccountYet') }} <NuxtLink to="/register" class="underline">
          {{ t('signUp') }}
        </NuxtLink>
      </p>
      <p class="text-center text-sm">
        <NuxtLink to="/resend-verification" class="underline">
          {{ t('resendVerificationEmail') }}
        </NuxtLink>
      </p>
    </UForm>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Sign in",
    "emailLabel": "Email",
    "emailPlaceholder": "Enter your email",
    "passwordLabel": "Password",
    "passwordPlaceholder": "Enter your password",
    "forgotPassword": "Forgot my password",
    "signingIn": "Signing in…",
    "signInWithBiometrics": "Sign in with biometrics",
    "noAccountYet": "No account yet?",
    "signUp": "Sign up",
    "resendVerificationEmail": "Resend verification email",
    "welcomeBack": "Welcome back!"
  }
}
</i18n>
