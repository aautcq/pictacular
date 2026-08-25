<script setup lang="ts">
const route = useRoute()
const { setNewPassword } = useCurrentUser()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const password = shallowRef('')
const passwordConfirmation = shallowRef('')
const loading = shallowRef(false)
const done = shallowRef(false)

async function submit() {
  loading.value = true
  try {
    await setNewPassword(route.params.token as string, password.value, passwordConfirmation.value)
    done.value = true
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
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

    <UForm
      v-else
      class="space-y-4"
      :state="{ password, passwordConfirmation }"
      novalidate
      @submit.prevent="submit"
    >
      <UFormField :label="t('newPasswordLabel')" name="password">
        <UInput
          v-model="password"
          type="password"
          required
          autocomplete="new-password"
          autofocus
          :placeholder="t('passwordPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('confirmNewPasswordLabel')" name="passwordConfirmation">
        <UInput
          v-model="passwordConfirmation"
          type="password"
          required
          autocomplete="new-password"
          :placeholder="t('confirmPasswordPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UButton
        type="submit"
        :loading="loading"
        :label="loading ? t('submitting') : t('submit')"
        block
      />
    </UForm>
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
