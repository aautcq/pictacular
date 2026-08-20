<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { login } = useCurrentUser()
const { addError, addSuccess } = useAlerts()
const route = useRoute()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    await login(email.value, password.value)
    addSuccess('Welcome back!')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.push(redirect)
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
      Sign in
    </template>

    <form class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="email" label="Email" type="email" required autocomplete="email" />
      <AppFormField v-model="password" label="Password" type="password" required autocomplete="current-password" />

      <div class="flex justify-end">
        <NuxtLink to="/forgot-password" class="text-sm underline">
          Forgot my password
        </NuxtLink>
      </div>

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </button>

      <p class="text-center text-sm">
        No account yet? <NuxtLink to="/register" class="underline">
          Sign up
        </NuxtLink>
      </p>
      <p class="text-center text-sm">
        <NuxtLink to="/resend-verification" class="underline">
          Resend verification email
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
</template>
