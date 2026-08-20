<script setup lang="ts">
const route = useRoute()
const { verifyAccount } = useCurrentUser()

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
      Account verification
    </template>

    <div class="flex flex-col items-center gap-y-6 text-center">
      <p v-if="status === 'pending'">
        Verifying your account…
      </p>
      <p v-else-if="status === 'success'">
        Your account is verified. You can now sign in.
      </p>
      <p v-else>
        This verification link is invalid or has expired.
      </p>

      <div class="flex flex-col items-center gap-y-2">
        <NuxtLink to="/login" class="text-sm underline">
          Go to sign in
        </NuxtLink>
        <NuxtLink v-if="status === 'error'" to="/resend-verification" class="text-sm underline">
          Resend verification email
        </NuxtLink>
      </div>
    </div>
  </AuthCard>
</template>
