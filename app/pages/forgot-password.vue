<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { requestPasswordReset } = useCurrentUser()
const toast = useToast()
const { translateError, getFieldErrors } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const form = useTemplateRef('form')
const email = shallowRef('')
const loading = shallowRef(false)
const sent = shallowRef(false)

async function submit() {
  loading.value = true
  try {
    await requestPasswordReset(email.value)
    sent.value = true
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

    <UForm
      v-else
      ref="form"
      :schema="resetPasswordSchema"
      :state="{ email }"
      class="space-y-4"
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

      <UButton
        type="submit"
        :loading="loading"
        block
        :label="loading ? t('submitting') : t('submit')"
      />

      <p class="text-center text-sm">
        <NuxtLink to="/login" class="underline">
          {{ t('backToSignIn') }}
        </NuxtLink>
      </p>
    </UForm>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Password forgotten",
    "emailLabel": "Email",
    "emailPlaceholder": "Enter your email address",
    "submit": "Reset password",
    "submitting": "Sending…",
    "sentMessage": "If an account exists for {email}, we've sent a link to reset your password.",
    "backToSignIn": "Back to sign in"
  }
}
</i18n>
