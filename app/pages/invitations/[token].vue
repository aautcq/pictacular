<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const route = useRoute()
const token = computed(() => route.params.token as string)

const { fetchInvitation } = useInvitations()
const { register, resendVerification } = useCurrentUser()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const { data: invitation, status } = await useAsyncData(
  `invitation-${token.value}`,
  async () => await fetchInvitation(token.value),
)

useHead({ title: computed(() => invitation.value?.title) })

const submitted = shallowRef(false)
const loading = shallowRef(false)
const resent = shallowRef(false)
const resending = shallowRef(false)
const state = reactive({
  first_name: '',
  last_name: '',
  password: '',
  password_confirmation: '',
})

async function submit() {
  if (!invitation.value)
    return

  loading.value = true
  try {
    await register({ ...state, email: invitation.value.email })
    submitted.value = true
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
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
    toast.add({ title: t('verificationResent') })
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    resending.value = false
  }
}
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <p v-if="status === 'pending'" class="text-center text-sm text-gray-500 dark:text-gray-300">
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

    <UForm
      v-else
      class="space-y-4"
      :state="{ ...state, email: invitation!.email }"
      novalidate
      @submit.prevent="submit"
    >
      <i18n-t keypath="invitedBy" tag="p" class="text-center text-sm text-gray-600 dark:text-gray-300">
        <template #name>
          <strong>{{ invitation!.admin.first_name }} {{ invitation!.admin.last_name }}</strong>
        </template>
        <template #title>
          <strong>{{ invitation!.title }}</strong>
        </template>
      </i18n-t>

      <UFormField :label="t('emailLabel')" name="email">
        <UInput
          :model-value="invitation!.email"
          type="email"
          disabled
          autocomplete="email"
          required
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('firstNameLabel')" name="first_name">
        <UInput
          v-model="state.first_name"
          type="text"
          required
          autocomplete="given-name"
          autofocus
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('lastNameLabel')" name="last_name">
        <UInput
          v-model="state.last_name"
          type="text"
          required
          autocomplete="family-name"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('passwordLabel')" name="password">
        <BasePasswordInput
          v-model="state.password"
          required
          autocomplete="new-password"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('confirmPasswordLabel')" name="password_confirmation">
        <BasePasswordInput
          v-model="state.password_confirmation"
          required
          autocomplete="new-password"
          class="w-full"
        />
      </UFormField>

      <UButton
        type="submit"
        :loading="loading"
        :label="loading ? t('signingUp') : t('submit')"
      />

      <p class="text-center text-sm">
        {{ t('alreadyHaveAccount') }} <NuxtLink to="/login" class="underline">
          {{ t('signIn') }}
        </NuxtLink>
      </p>
    </UForm>
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
