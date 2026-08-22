<script setup lang="ts">
const route = useRoute()
const { setNewPassword } = useCurrentUser()
const { addError } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()

const password = ref('')
const passwordConfirmation = ref('')
const loading = ref(false)
const done = ref(false)

async function submit() {
  loading.value = true
  try {
    await setNewPassword(route.params.token as string, password.value, passwordConfirmation.value)
    done.value = true
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

    <div v-if="done" class="flex flex-col items-center gap-y-6 text-center">
      <p>{{ t('doneMessage') }}</p>
      <NuxtLink to="/login" class="text-sm underline">
        {{ t('goToSignIn') }}
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="password" :label="t('newPasswordLabel')" type="password" required autocomplete="new-password" />
      <AppFormField v-model="passwordConfirmation" :label="t('confirmNewPasswordLabel')" type="password" required autocomplete="new-password" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? t('submitting') : t('submit') }}
      </button>
    </form>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Set a new password",
    "doneMessage": "Your password has been updated. You can now sign in.",
    "goToSignIn": "Go to sign in",
    "newPasswordLabel": "New password",
    "confirmNewPasswordLabel": "Confirm new password",
    "submit": "Set new password",
    "submitting": "Saving…"
  }
}
</i18n>
