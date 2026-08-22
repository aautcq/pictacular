<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { requestPasswordReset } = useCurrentUser()
const { addError } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()

const email = ref('')
const loading = ref(false)
const sent = ref(false)

async function submit() {
  loading.value = true
  try {
    await requestPasswordReset(email.value)
    sent.value = true
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

    <div v-if="sent" class="flex flex-col items-center gap-y-6 text-center">
      <i18n-t keypath="sentMessage" tag="p">
        <template #email>
          <strong>{{ email }}</strong>
        </template>
      </i18n-t>
      <NuxtLink to="/login" class="text-sm underline">
        {{ t('backToSignIn') }}
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="email" :label="t('emailLabel')" type="email" required autocomplete="email" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? t('submitting') : t('submit') }}
      </button>

      <p class="text-center text-sm">
        <NuxtLink to="/login" class="underline">
          {{ t('backToSignIn') }}
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Password forgotten",
    "emailLabel": "Email",
    "submit": "Reset password",
    "submitting": "Sending…",
    "sentMessage": "If an account exists for {email}, we've sent a link to reset your password.",
    "backToSignIn": "Back to sign in"
  }
}
</i18n>
