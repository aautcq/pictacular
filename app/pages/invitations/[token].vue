<script setup lang="ts">
import type { InvitationAlbum } from '~/composables/useInvitations'

definePageMeta({ middleware: 'guest' })

const route = useRoute()
const token = computed(() => route.params.token as string)

const { fetchInvitation } = useInvitations()
const { register, resendVerification } = useCurrentUser()
const { addError, addSuccess } = useAlerts()

const status = ref<'loading' | 'ready' | 'error'>('loading')
const invitation = ref<InvitationAlbum | null>(null)
const submitted = ref(false)
const loading = ref(false)
const resent = ref(false)
const resending = ref(false)
const form = reactive({
  first_name: '',
  last_name: '',
  password: '',
  password_confirmation: '',
})

async function loadInvitation() {
  status.value = 'loading'
  try {
    invitation.value = await fetchInvitation(token.value)
    status.value = 'ready'
  }
  catch {
    status.value = 'error'
  }
}

async function submit() {
  if (!invitation.value)
    return

  loading.value = true
  try {
    await register({ ...form, email: invitation.value.email })
    submitted.value = true
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    loading.value = false
  }
}

// Issue #52 acceptance criteria: re-inviting an email that already exists
// resends rather than errors. If someone registered on their own (but
// hasn't verified yet) between being invited and following this link, the
// signup form above would fail with auth.email_taken — so this screen
// offers a "resend the verification email" path instead of a dead end
// (verifying still auto-adds them as a Collaborator, see
// server/api/auth/verify/[token].get.ts).
async function resend() {
  if (!invitation.value)
    return

  resending.value = true
  try {
    await resendVerification(invitation.value.email)
    resent.value = true
    addSuccess('Verification email resent.')
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    resending.value = false
  }
}

onMounted(loadInvitation)
</script>

<template>
  <AuthCard>
    <template #title>
      Album invitation
    </template>

    <p v-if="status === 'loading'" class="text-center text-sm text-slate-500 dark:text-slate-300">
      Loading invitation…
    </p>

    <div v-else-if="status === 'error'" class="flex flex-col items-center gap-y-6 text-center">
      <p>This invitation link is invalid or has expired.</p>
      <NuxtLink to="/login" class="text-sm underline">
        Go to sign in
      </NuxtLink>
    </div>

    <div v-else-if="submitted" class="flex flex-col items-center gap-y-6 text-center">
      <p>
        Check your inbox: we've sent a verification link to <strong>{{ invitation!.email }}</strong>.
        Once you verify your account, you'll automatically get access to
        <strong>{{ invitation!.title }}</strong>.
      </p>
      <NuxtLink to="/resend-verification" class="text-sm underline">
        Didn't receive it? Resend the verification email
      </NuxtLink>
    </div>

    <div v-else-if="invitation!.has_pending_account" class="flex flex-col items-center gap-y-6 text-center">
      <p v-if="!resent">
        You've already started signing up with <strong>{{ invitation!.email }}</strong>.
        Resend your verification email to finish and get access to
        <strong>{{ invitation!.title }}</strong>.
      </p>
      <p v-else>
        Check your inbox: we've resent a verification link to <strong>{{ invitation!.email }}</strong>.
        Once you verify your account, you'll automatically get access to
        <strong>{{ invitation!.title }}</strong>.
      </p>
      <button
        v-if="!resent"
        type="button"
        :disabled="resending"
        class="h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
        @click="resend"
      >
        {{ resending ? 'Resending…' : 'Resend verification email' }}
      </button>
      <NuxtLink to="/login" class="text-sm underline">
        Already verified? Sign in
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <p class="text-center text-sm text-slate-600 dark:text-slate-300">
        <strong>{{ invitation!.admin.first_name }} {{ invitation!.admin.last_name }}</strong>
        invited you to collaborate on <strong>{{ invitation!.title }}</strong>. Sign up to accept.
      </p>

      <AppFormField :model-value="invitation!.email" label="Email" type="email" disabled autocomplete="email" />
      <AppFormField v-model="form.first_name" label="First name" required autocomplete="given-name" />
      <AppFormField v-model="form.last_name" label="Last name" required autocomplete="family-name" />
      <AppFormField v-model="form.password" label="Password" type="password" required autocomplete="new-password" />
      <AppFormField v-model="form.password_confirmation" label="Confirm password" type="password" required autocomplete="new-password" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? 'Signing up…' : 'Sign up and join album' }}
      </button>

      <p class="text-center text-sm">
        Already have an account? <NuxtLink to="/login" class="underline">
          Sign in
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
</template>
