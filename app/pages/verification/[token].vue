<script setup lang="ts">
const route = useRoute()
const { verifyAccount } = useCurrentUser()
const { t } = useI18n()

const status = ref<'pending' | 'success' | 'error'>('pending')

onMounted(async () => {
  try {
    await verifyAccount(route.params.token as string)
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
})
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <div class="flex flex-col items-center gap-y-6 text-center">
      <p v-if="status === 'pending'">
        {{ t('pending') }}
      </p>
      <p v-else-if="status === 'success'">
        {{ t('success') }}
      </p>
      <p v-else>
        {{ t('error') }}
      </p>

      <div class="flex flex-col items-center gap-y-2">
        <NuxtLink to="/login" class="text-sm underline">
          {{ t('goToSignIn') }}
        </NuxtLink>
        <NuxtLink v-if="status === 'error'" to="/resend-verification" class="text-sm underline">
          {{ t('resendVerificationEmail') }}
        </NuxtLink>
      </div>
    </div>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Account verification",
    "pending": "Verifying your account…",
    "success": "Your account is verified. You can now sign in.",
    "error": "This verification link is invalid or has expired.",
    "goToSignIn": "Go to sign in",
    "resendVerificationEmail": "Resend verification email"
  }
}
</i18n>
