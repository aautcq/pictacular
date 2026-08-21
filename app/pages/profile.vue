<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { user, fullName, uploadAvatar, deleteAccount } = useCurrentUser()
const { hasStoredCredential, isSupported, registerCredential } = useBiometrics()
const { addError, addSuccess } = useAlerts()
const { translateError } = useErrorMessage()
const { open: openDeleteConfirm, close: closeDeleteConfirm } = useModal('delete-account')
const router = useRouter()

const fileInput = ref<HTMLInputElement | null>(null)
const deleting = ref(false)
const registeringBiometrics = ref(false)

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
      addSuccess('Avatar updated.')
    }
    catch (error) {
      addError(translateError(error))
    }
  }
  reader.readAsDataURL(file)
}

async function registerBiometrics() {
  registeringBiometrics.value = true
  try {
    await registerCredential()
    addSuccess('Biometric credential registered.')
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    registeringBiometrics.value = false
  }
}

async function confirmDelete() {
  deleting.value = true
  try {
    await deleteAccount()
    closeDeleteConfirm()
    await router.push('/login')
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-lg flex-col gap-y-10 py-10">
    <div class="flex items-center gap-x-6">
      <button
        type="button"
        class="relative h-20 w-20 flex-none overflow-hidden rounded-full bg-slate-300 dark:bg-slate-600"
        title="Change avatar"
        @click="fileInput?.click()"
      >
        <img v-if="user?.avatar_url" :src="user.avatar_url" alt="Your avatar" class="h-full w-full object-cover">
        <span v-else class="flex h-full w-full items-center justify-center text-2xl font-semibold uppercase text-slate-600 dark:text-slate-200">
          {{ initials }}
        </span>
      </button>
      <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onAvatarSelected">

      <div>
        <h1 class="text-lg font-semibold">
          {{ fullName }}
        </h1>
        <p class="text-slate-500 dark:text-slate-300">
          {{ user?.email }}
        </p>
      </div>
    </div>

    <div class="flex justify-end gap-3">
      <button
        v-if="isSupported"
        type="button"
        :disabled="registeringBiometrics"
        class="h-10 rounded border border-slate-300 px-4 font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-700"
        @click="registerBiometrics"
      >
        {{ registeringBiometrics ? 'Registering…' : (hasStoredCredential ? 'Re-register a biometric credential' : 'Register a biometric credential') }}
      </button>
      <button
        type="button"
        class="h-10 rounded bg-red-500 px-4 font-medium text-white hover:bg-red-600"
        @click="openDeleteConfirm"
      >
        Delete my account
      </button>
    </div>

    <AppModal name="delete-account">
      <div class="flex flex-col gap-y-6">
        <h2 class="text-lg font-semibold">
          Delete your account
        </h2>
        <p>This action is irreversible. Are you sure you want to permanently delete your account?</p>
        <div class="flex justify-end gap-3">
          <button
            type="button"
            class="h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
            @click="closeDeleteConfirm"
          >
            Cancel
          </button>
          <button
            type="button"
            :disabled="deleting"
            class="h-10 rounded bg-red-500 px-4 font-medium text-white hover:bg-red-600 disabled:opacity-50"
            @click="confirmDelete"
          >
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </AppModal>
  </div>
</template>
