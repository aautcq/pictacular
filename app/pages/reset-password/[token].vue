<script setup lang="ts">
const route = useRoute()
const { setNewPassword } = useCurrentUser()
const { addError } = useAlerts()

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
      Set a new password
    </template>

    <div v-if="done" class="flex flex-col items-center gap-y-6 text-center">
      <p>Your password has been updated. You can now sign in.</p>
      <NuxtLink to="/login" class="text-sm underline">
        Go to sign in
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="password" label="New password" type="password" required autocomplete="new-password" />
      <AppFormField v-model="passwordConfirmation" label="Confirm new password" type="password" required autocomplete="new-password" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? 'Saving…' : 'Set new password' }}
      </button>
    </form>
  </AuthCard>
</template>
