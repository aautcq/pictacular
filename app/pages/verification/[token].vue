<script setup lang="ts">
const route = useRoute()
const { verifyAccount } = useCurrentUser()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const { status } = await useAsyncData(
  `verification-${route.params.token as string}`,
  async () => await verifyAccount(route.params.token as string),
)
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
