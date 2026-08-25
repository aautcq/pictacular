<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { user, fullName, uploadAvatar, deleteAccount } = useCurrentUser()
const { hasStoredCredential, isSupported, registerCredential } = useBiometrics()
const toast = useToast()
const { translateError } = useErrorMessage()
const router = useRouter()
const { t } = useI18n()
const colorMode = useColorMode()

const isDark = computed(() => colorMode.value === 'dark')
const fileInput = ref<HTMLInputElement | null>(null)
const deleting = ref(false)
const registeringBiometrics = ref(false)
const isDeleteModalOpen = ref(false)

const initials = computed(() => `${user.value?.first_name?.[0] ?? ''}${user.value?.last_name?.[0] ?? ''}`)

function onAvatarSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file)
    return

  const reader = new FileReader()
  reader.onloadend = async () => {
    const base64 = (reader.result as string).replace(/^data:.+;base64,/, '')
    try {
      await uploadAvatar({ filename: file.name, mime_type: file.type, base64 })
      toast.add({ title: t('avatarUpdated') })
    }
    catch (error) {
      toast.add({ title: translateError(error), color: 'error' })
    }
  }
  reader.readAsDataURL(file)
}

async function registerBiometrics() {
  registeringBiometrics.value = true
  try {
    await registerCredential()
    toast.add({ title: t('biometricRegistered') })
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    registeringBiometrics.value = false
  }
}

async function confirmDelete() {
  deleting.value = true
  try {
    await deleteAccount()
    isDeleteModalOpen.value = false
    await router.push('/login')
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    deleting.value = false
  }
}

function toggle() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}
</script>

<template>
  <div class="mx-auto flex max-w-lg flex-col gap-y-10 py-10">
    <div class="flex items-center gap-x-6">
      <button
        type="button"
        class="relative h-20 w-20 flex-none overflow-hidden rounded-full bg-gray-300 dark:bg-gray-600"
        :title="t('changeAvatar')"
        @click="fileInput?.click()"
      >
        <img v-if="user?.avatar_url" :src="user.avatar_url" :alt="t('avatarAlt')" class="h-full w-full object-cover">
        <span v-else class="flex h-full w-full items-center justify-center text-2xl font-semibold uppercase text-gray-600 dark:text-gray-200">
          {{ initials }}
        </span>
      </button>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onAvatarSelected">

      <div>
        <h1 class="text-lg font-semibold">
          {{ fullName }}
        </h1>
        <p class="text-gray-500 dark:text-gray-300">
          {{ user?.email }}
        </p>
      </div>
    </div>

    <div class="flex justify-end gap-3">
      <ClientOnly>
        <UTooltip :text="isDark ? t('toggleToLight') : t('toggleToDark')">
          <UButton
            type="button"
            color="neutral"
            variant="soft"
            :aria-label="isDark ? t('toggleToLight') : t('toggleToDark')"
            :icon="isDark ? 'ph:sun' : 'ph:moon'"
            @click="toggle"
          />
        </UTooltip>
      </ClientOnly>

      <UButton
        v-if="isSupported"
        type="button"
        :disabled="registeringBiometrics"
        :label="registeringBiometrics ? t('registering') : (hasStoredCredential ? t('reRegisterBiometric') : t('registerBiometric'))"
        color="neutral"
        variant="soft"
        @click="registerBiometrics"
      />

      <UModal
        v-model:open="isDeleteModalOpen"
        :title="t('deleteModalTitle')"
        :description="t('deleteModalBody')"
      >
        <UButton
          type="button"
          :label="t('deleteAccount')"
          color="error"
          icon="ph:trash"
        />

        <template #footer="{ close }">
          <UButton
            type="button"
            :label="t('cancel')"
            color="neutral"
            variant="soft"
            @click="close"
          />
          <UButton
            type="button"
            :loading="deleting"
            :label="deleting ? t('deleting') : t('deleteButton')"
            color="error"
            @click="confirmDelete"
          />
        </template>
      </UModal>
    </div>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "changeAvatar": "Change avatar",
    "avatarAlt": "Your avatar",
    "registering": "Registering…",
    "reRegisterBiometric": "Re-register a biometric credential",
    "registerBiometric": "Register a biometric credential",
    "deleteAccount": "Delete my account",
    "avatarUpdated": "Avatar updated.",
    "biometricRegistered": "Biometric credential registered.",
    "deleteModalTitle": "Delete your account",
    "deleteModalBody": "This action is irreversible. Are you sure you want to permanently delete your account?",
    "cancel": "Cancel",
    "deleting": "Deleting…",
    "deleteButton": "Delete",
    "toggleToLight": "Switch to light mode",
    "toggleToDark": "Switch to dark mode"
  }
}
</i18n>
