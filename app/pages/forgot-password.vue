<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { requestPasswordReset } = useCurrentUser()
const { addError } = useAlerts()

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
      Password forgotten
    </template>

    <div v-if="sent" class="flex flex-col items-center gap-y-6 text-center">
      <p>
        If an account exists for <strong>{{ email }}</strong>, we've sent a link to reset your password.
      </p>
      <NuxtLink to="/login" class="text-sm underline">
        Back to sign in
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="email" label="Email" type="email" required autocomplete="email" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? 'Sending…' : 'Reset password' }}
      </button>

      <p class="text-center text-sm">
        <NuxtLink to="/login" class="underline">
          Back to sign in
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
</template>
