<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { user, fullName, uploadAvatar, deleteAccount, logout } = useCurrentUser()
const { hasStoredCredential, isSupported, registerCredential } = useBiometrics()
const toast = useToast()
const { translateError } = useErrorMessage()
const router = useRouter()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })
const colorMode = useColorMode()

const isDark = computed(() => colorMode.value === 'dark')
const fileInput = ref<HTMLInputElement | null>(null)
const deleting = ref(false)
const registeringBiometrics = ref(false)
const isDeleteModalOpen = ref(false)

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

async function handleLogout() {
  await logout()
  await navigateTo('/login')
}
</script>

<template>
  <div class="mx-auto flex max-w-lg flex-col gap-y-10 py-10">
    <div class="flex items-center gap-x-6">
      <UTooltip :text="t('changeAvatar')">
        <button
          type="button"
          :aria-label="t('changeAvatar')"
          class="cursor-pointer"
          @click="fileInput?.click()"
        >
          <UAvatar
            :src="user?.avatar_url ?? undefined"
            :alt="fullName"
            size="3xl"
          />
        </button>
      </UTooltip>
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

    <div>
      <h2 class="mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        {{ t('preferences') }}
      </h2>
      <ClientOnly>
        <UButton
          type="button"
          color="neutral"
          variant="soft"
          :label="isDark ? t('toggleToLight') : t('toggleToDark')"
          :icon="isDark ? 'ph:sun' : 'ph:moon'"
          block
          @click="toggle"
        />
      </ClientOnly>
    </div>

    <div>
      <h2 class="mb-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
        {{ t('account') }}
      </h2>

      <div class="flex flex-col gap-y-4">
        <UButton
          type="button"
          color="neutral"
          variant="soft"
          icon="ph:power"
          block
          :label="tg('common.nav.logOut')"
          @click="handleLogout"
        />

        <UButton
          v-if="isSupported"
          type="button"
          color="neutral"
          variant="soft"
          icon="ph:fingerprint"
          block
          :disabled="registeringBiometrics"
          :label="registeringBiometrics ? t('registering') : (hasStoredCredential ? t('reRegisterBiometric') : t('registerBiometric'))"
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
            variant="soft"
            icon="ph:trash"
            block
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
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "changeAvatar": "Change avatar",
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
    "toggleToDark": "Switch to dark mode",
    "preferences": "Preferences",
    "account": "Account"
  }
}
</i18n>
