<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { connectStorage, checkBucket } = useCurrentUser()
const { addError } = useAlerts()
const router = useRouter()

const mode = ref<'create' | 'connect' | null>(null)
const bucket = ref('')
const access_key_id = ref('')
const secret_access_key = ref('')
const loading = ref(false)
const hasPhotos = ref(false)
const connected = ref(false)

function selectMode(value: 'create' | 'connect') {
  mode.value = value
}

async function submit() {
  if (!mode.value)
    return

  loading.value = true
  try {
    await connectStorage(
      mode.value === 'create'
        ? { mode: 'create', access_key_id: access_key_id.value, secret_access_key: secret_access_key.value }
        : { mode: 'connect', access_key_id: access_key_id.value, secret_access_key: secret_access_key.value, bucket: bucket.value },
    )

    connected.value = true
    hasPhotos.value = mode.value === 'connect' ? await checkBucket() : false
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    loading.value = false
  }
}

function continueToApp() {
  router.push('/')
}
</script>

<template>
  <AuthCard>
    <template #title>
      Connect your storage
    </template>

    <div v-if="connected" class="flex flex-col items-center gap-y-6 text-center">
      <p v-if="hasPhotos">
        It looks like your bucket already has some image files in it. Import support is coming
        soon — for now you can head into Pictacular and we'll pick up from there.
      </p>
      <p v-else>
        Your storage connection is ready.
      </p>
      <button
        type="button"
        class="h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
        @click="continueToApp"
      >
        Continue
      </button>
    </div>

    <div v-else class="flex flex-col gap-y-6">
      <div class="flex flex-col gap-y-3 text-sm text-slate-600 dark:text-slate-300">
        <p>
          Pictacular stores your photos in your own AWS S3 bucket. Provide an AWS access key +
          secret key, then either create a new bucket for Pictacular or connect one you
          already have.
        </p>
      </div>

      <div class="flex justify-center gap-x-4">
        <button
          type="button"
          class="h-10 rounded px-4 font-medium"
          :class="mode === 'create' ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-700'"
          @click="selectMode('create')"
        >
          Create a new bucket for me
        </button>
        <button
          type="button"
          class="h-10 rounded px-4 font-medium"
          :class="mode === 'connect' ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-700'"
          @click="selectMode('connect')"
        >
          I already have a bucket
        </button>
      </div>

      <form v-if="mode" class="flex flex-col gap-y-4" @submit.prevent="submit">
        <AppFormField v-if="mode === 'connect'" v-model="bucket" label="Bucket name" required autocomplete="off" />
        <AppFormField v-model="access_key_id" label="Access key ID" type="password" required autocomplete="off" />
        <AppFormField v-model="secret_access_key" label="Secret access key" type="password" required autocomplete="off" />

        <button
          type="submit"
          :disabled="loading"
          class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
        >
          {{ loading ? 'Connecting…' : 'Connect' }}
        </button>
      </form>
    </div>
  </AuthCard>
</template>
