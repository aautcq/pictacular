<script setup lang="ts">
import type { InvitationAlbum } from '~/composables/useInvitations'

definePageMeta({ middleware: 'guest' })

const route = useRoute()
const token = computed(() => route.params.token as string)

const { fetchInvitation } = useInvitations()
const { register, resendVerification } = useCurrentUser()
const { addError, addSuccess } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()

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
    addSuccess(t('verificationResent'))
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
      {{ t('title') }}
    </template>

    <p v-if="status === 'loading'" class="text-center text-sm text-slate-500 dark:text-slate-300">
      {{ t('loadingInvitation') }}
    </p>

    <div v-else-if="status === 'error'" class="flex flex-col items-center gap-y-6 text-center">
      <p>{{ t('invalidLink') }}</p>
      <NuxtLink to="/login" class="text-sm underline">
        {{ t('goToSignIn') }}
      </NuxtLink>
    </div>

    <div v-else-if="submitted" class="flex flex-col items-center gap-y-6 text-center">
      <i18n-t keypath="checkInboxNew" tag="p">
        <template #email>
          <strong>{{ invitation!.email }}</strong>
        </template>
        <template #title>
          <strong>{{ invitation!.title }}</strong>
        </template>
      </i18n-t>
      <NuxtLink to="/resend-verification" class="text-sm underline">
        {{ t('resendDidntReceive') }}
      </NuxtLink>
    </div>

    <div v-else-if="invitation!.has_pending_account" class="flex flex-col items-center gap-y-6 text-center">
      <i18n-t v-if="!resent" keypath="alreadyStarted" tag="p">
        <template #email>
          <strong>{{ invitation!.email }}</strong>
        </template>
        <template #title>
          <strong>{{ invitation!.title }}</strong>
        </template>
      </i18n-t>
      <i18n-t v-else keypath="checkInboxResent" tag="p">
        <template #email>
          <strong>{{ invitation!.email }}</strong>
        </template>
        <template #title>
          <strong>{{ invitation!.title }}</strong>
        </template>
      </i18n-t>
      <button
        v-if="!resent"
        type="button"
        :disabled="resending"
        class="h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
        @click="resend"
      >
        {{ resending ? t('resending') : t('resendButton') }}
      </button>
      <NuxtLink to="/login" class="text-sm underline">
        {{ t('alreadyVerifiedSignIn') }}
      </NuxtLink>
    </div>

    <form v-else class="flex flex-col gap-y-4" @submit.prevent="submit">
      <i18n-t keypath="invitedBy" tag="p" class="text-center text-sm text-slate-600 dark:text-slate-300">
        <template #name>
          <strong>{{ invitation!.admin.first_name }} {{ invitation!.admin.last_name }}</strong>
        </template>
        <template #title>
          <strong>{{ invitation!.title }}</strong>
        </template>
      </i18n-t>

      <AppFormField :model-value="invitation!.email" :label="t('emailLabel')" type="email" disabled autocomplete="email" />
      <AppFormField v-model="form.first_name" :label="t('firstNameLabel')" required autocomplete="given-name" />
      <AppFormField v-model="form.last_name" :label="t('lastNameLabel')" required autocomplete="family-name" />
      <AppFormField v-model="form.password" :label="t('passwordLabel')" type="password" required autocomplete="new-password" />
      <AppFormField v-model="form.password_confirmation" :label="t('confirmPasswordLabel')" type="password" required autocomplete="new-password" />

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? t('signingUp') : t('submit') }}
      </button>

      <p class="text-center text-sm">
        {{ t('alreadyHaveAccount') }} <NuxtLink to="/login" class="underline">
          {{ t('signIn') }}
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Album invitation",
    "loadingInvitation": "Loading invitation…",
    "invalidLink": "This invitation link is invalid or has expired.",
    "goToSignIn": "Go to sign in",
    "checkInboxNew": "Check your inbox: we've sent a verification link to {email}. Once you verify your account, you'll automatically get access to {title}.",
    "resendDidntReceive": "Didn't receive it? Resend the verification email",
    "alreadyStarted": "You've already started signing up with {email}. Resend your verification email to finish and get access to {title}.",
    "checkInboxResent": "Check your inbox: we've resent a verification link to {email}. Once you verify your account, you'll automatically get access to {title}.",
    "resending": "Resending…",
    "resendButton": "Resend verification email",
    "alreadyVerifiedSignIn": "Already verified? Sign in",
    "invitedBy": "{name} invited you to collaborate on {title}. Sign up to accept.",
    "emailLabel": "Email",
    "firstNameLabel": "First name",
    "lastNameLabel": "Last name",
    "passwordLabel": "Password",
    "confirmPasswordLabel": "Confirm password",
    "signingUp": "Signing up…",
    "submit": "Sign up and join album",
    "alreadyHaveAccount": "Already have an account?",
    "signIn": "Sign in",
    "verificationResent": "Verification email resent."
  }
}
</i18n>
