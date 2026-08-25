<script setup lang="ts">
const { resendVerification } = useCurrentUser()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const email = shallowRef('')
const loading = shallowRef(false)
const sent = shallowRef(false)

async function submit() {
  loading.value = true
  try {
    await resendVerification(email.value)
    sent.value = true
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
      class="space-y-4"
      :state="{ email }"
      novalidate
      @submit.prevent="submit"
    >
      <UFormField :label="t('emailLabel')" name="email">
        <UInput
          v-model="email"
          type="email"
          autofocus
          autocomplete="email"
          :placeholder="t('emailPlaceholder')"
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
    "title": "Resend verification email",
    "emailLabel": "Email",
    "emailPlaceholder": "Enter your email address",
    "submit": "Resend email",
    "submitting": "Sending…",
    "sentMessage": "If an unverified account exists for {email}, we've sent a new verification link.",
    "backToSignIn": "Back to sign in"
  }
}
</i18n>
