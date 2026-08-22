<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { login, loginWithBiometrics } = useCurrentUser()
const { hasStoredCredential, isSupported } = useBiometrics()
const { addError, addSuccess } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const biometricLoading = ref(false)
// Only one sign-in ceremony may be in flight at a time: both `login` and
// `loginWithBiometrics` create a new Session and revoke the User's other
// active sessions server-side, so letting the password form and the
// automatic/manual biometric attempt race would issue two competing
// sessions and navigate twice.
const anyLoading = computed(() => loading.value || biometricLoading.value)

async function redirectAfterSignIn() {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  await router.push(redirect)
}

async function submit() {
  if (anyLoading.value)
    return

  loading.value = true
  try {
    await login(email.value, password.value)
    addSuccess(t('welcomeBack'))
    await redirectAfterSignIn()
  }
  catch (error) {
    addError(translateError(error))
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
    addSuccess(t('welcomeBack'))
    await redirectAfterSignIn()
  }
  catch (error) {
    if (!silent)
      addError(translateError(error))
  }
  finally {
    biometricLoading.value = false
  }
}

onMounted(() => {
  if (isSupported && hasStoredCredential.value)
    signInWithBiometrics({ silent: true })
})
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <form class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="email" :label="t('emailLabel')" type="email" required autocomplete="email" />
      <AppFormField v-model="password" :label="t('passwordLabel')" type="password" required autocomplete="current-password" />

      <div class="flex justify-end">
        <NuxtLink to="/forgot-password" class="text-sm underline">
          {{ t('forgotPassword') }}
        </NuxtLink>
      </div>

      <button
        type="submit"
        :disabled="anyLoading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? t('signingIn') : t('common.nav.signIn') }}
      </button>

      <button
        v-if="isSupported"
        type="button"
        :disabled="anyLoading"
        class="h-10 rounded border border-slate-300 px-4 font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
        @click="signInWithBiometrics()"
      >
        {{ biometricLoading ? t('signingIn') : t('signInWithBiometrics') }}
      </button>

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
    </form>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Sign in",
    "emailLabel": "Email",
    "passwordLabel": "Password",
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
