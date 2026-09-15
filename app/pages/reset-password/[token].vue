<script setup lang="ts">
const route = useRoute()
const { setNewPassword } = useCurrentUser()
const toast = useToast()
const { translateError, getFieldErrors } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const form = useTemplateRef('form')
const password = shallowRef('')
const password_confirmation = shallowRef('')
const loading = shallowRef(false)
const done = shallowRef(false)

async function submit() {
  loading.value = true
  try {
    await setNewPassword(route.params.token as string, password.value, password_confirmation.value)
    done.value = true
  }
  catch (error) {
    form.value?.setErrors(getFieldErrors(error))
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
      ref="form"
      class="space-y-4"
      :schema="setPasswordSchema"
      :state="{ password, password_confirmation }"
      @submit.prevent="submit"
    >
      <UFormField :label="t('newPasswordLabel')" name="password">
        <BasePasswordInput
          v-model="password"
          required
          autocomplete="new-password"
          autofocus
          :placeholder="t('passwordPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('confirmNewPasswordLabel')" name="password_confirmation">
        <BasePasswordInput
          v-model="password_confirmation"
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
    "passwordPlaceholder": "Enter your new password",
    "confirmNewPasswordLabel": "Confirm new password",
    "confirmPasswordPlaceholder": "Re-enter your new password",
    "submit": "Set new password",
    "submitting": "Saving…"
  }
}
</i18n>
