<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { register } = useCurrentUser()
const { addError } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()

const loading = ref(false)
const submitted = ref(false)
const form = reactive({
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  password_confirmation: '',
})

async function submit() {
  loading.value = true
  try {
    await register({ ...form })
    submitted.value = true
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <div v-if="submitted" class="flex flex-col items-center gap-y-6 text-center">
      <i18n-t keypath="checkInbox" tag="p">
        <template #email>
          <strong>{{ form.email }}</strong>
        </template>
      </i18n-t>
      <NuxtLink to="/resend-verification" class="text-sm underline">
        {{ t('resendVerification') }}
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="form.first_name" :label="t('firstNameLabel')" required autocomplete="given-name" />
      <AppFormField v-model="form.last_name" :label="t('lastNameLabel')" required autocomplete="family-name" />
      <AppFormField v-model="form.email" :label="t('emailLabel')" type="email" required autocomplete="email" />
      <AppFormField v-model="form.password" :label="t('passwordLabel')" type="password" required autocomplete="new-password" />
      <AppFormField v-model="form.password_confirmation" :label="t('confirmPasswordLabel')" type="password" required autocomplete="new-password" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? t('submitting') : t('submit') }}
      </button>

      <p class="text-center text-sm">
        {{ t('alreadyHaveAccount') }} <NuxtLink to="/login" class="underline">
          {{ t('signIn') }}
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Sign up",
    "firstNameLabel": "First name",
    "lastNameLabel": "Last name",
    "emailLabel": "Email",
    "passwordLabel": "Password",
    "confirmPasswordLabel": "Confirm password",
    "submit": "Sign up",
    "submitting": "Signing up…",
    "checkInbox": "Check your inbox: we've sent a verification link to {email}. You must verify your account before signing in.",
    "resendVerification": "Didn't receive it? Resend the verification email",
    "alreadyHaveAccount": "Already have an account?",
    "signIn": "Sign in"
  }
}
</i18n>
