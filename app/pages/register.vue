<script setup lang="ts">
definePageMeta({ middleware: 'guest' })

const { register } = useCurrentUser()
const toast = useToast()
const { translateError, getFieldErrors } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const form = useTemplateRef('form')
const loading = shallowRef(false)
const submitted = shallowRef(false)
const state = reactive({
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  password_confirmation: '',
})

async function submit() {
  loading.value = true
  try {
    await register({ ...state })
    submitted.value = true
  }
  catch (error) {
    form.value?.setErrors(getFieldErrors(error))
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <div v-if="submitted" class="flex flex-col items-center gap-y-6 text-center">
      <i18n-t keypath="checkInbox" tag="p">
        <template #email>
          <strong>{{ state.email }}</strong>
        </template>
      </i18n-t>
      <NuxtLink to="/resend-verification" class="text-sm underline">
        {{ t('resendVerification') }}
      </NuxtLink>
    </div>

    <UForm
      v-else
      ref="form"
      :schema="registerSchema"
      :state="state"
      class="space-y-4"
      @submit.prevent="submit"
    >
      <UFormField :label="t('firstNameLabel')" name="first_name">
        <UInput
          v-model="state.first_name"
          type="text"
          autocomplete="given-name"
          autofocus
          :placeholder="t('firstNamePlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('lastNameLabel')" name="last_name">
        <UInput
          v-model="state.last_name"
          type="text"
          autocomplete="family-name"
          :placeholder="t('lastNamePlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('emailLabel')" name="email">
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="email"
          :placeholder="t('emailPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('passwordLabel')" name="password">
        <BasePasswordInput
          v-model="state.password"
          required
          autocomplete="new-password"
          :placeholder="t('passwordPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('confirmPasswordLabel')" name="password_confirmation">
        <BasePasswordInput
          v-model="state.password_confirmation"
          required
          autocomplete="new-password"
          :placeholder="t('confirmPasswordPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UButton
        type="submit"
        :loading="loading"
        block
        :label="loading ? t('submitting') : t('submit')"
      />

      <AuthGoogleButton />

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
    "title": "Sign up",
    "firstNameLabel": "First name",
    "firstNamePlaceholder": "Enter your first name",
    "lastNameLabel": "Last name",
    "lastNamePlaceholder": "Enter your last name",
    "emailLabel": "Email",
    "emailPlaceholder": "Enter your email address",
    "passwordLabel": "Password",
    "passwordPlaceholder": "Enter your password",
    "confirmPasswordLabel": "Confirm password",
    "confirmPasswordPlaceholder": "Confirm your password",
    "submit": "Sign up",
    "submitting": "Signing up…",
    "checkInbox": "Check your inbox: we've sent a verification link to {email}. You must verify your account before signing in.",
    "resendVerification": "Didn't receive it? Resend the verification email",
    "alreadyHaveAccount": "Already have an account?",
    "signIn": "Sign in"
  }
}
</i18n>
