<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { register } = useCurrentUser()
const { addError } = useAlerts()

const loading = ref(false)
const submitted = ref(false)
const form = reactive({
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  password_confirmation: '',
})

async function submit() {
  loading.value = true
  try {
    await register({ ...form })
    submitted.value = true
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
      Sign up
    </template>

    <div v-if="submitted" class="flex flex-col items-center gap-y-6 text-center">
      <p>
        Check your inbox: we've sent a verification link to <strong>{{ form.email }}</strong>.
        You must verify your account before signing in.
      </p>
      <NuxtLink to="/resend-verification" class="text-sm underline">
        Didn't receive it? Resend the verification email
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="form.first_name" label="First name" required autocomplete="given-name" />
      <AppFormField v-model="form.last_name" label="Last name" required autocomplete="family-name" />
      <AppFormField v-model="form.email" label="Email" type="email" required autocomplete="email" />
      <AppFormField v-model="form.password" label="Password" type="password" required autocomplete="new-password" />
      <AppFormField v-model="form.password_confirmation" label="Confirm password" type="password" required autocomplete="new-password" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? 'Signing up…' : 'Sign up' }}
      </button>

      <p class="text-center text-sm">
        Already have an account? <NuxtLink to="/login" class="underline">
          Sign in
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
</template>
