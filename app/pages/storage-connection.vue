<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { connectStorage, checkBucket } = useCurrentUser()
const { importing, progress, result, importPhotos } = useBucketImport()
const { addError } = useAlerts()
const { translateError } = useErrorMessage()
const router = useRouter()

const mode = ref<'create' | 'connect' | null>(null)
const bucket = ref('')
const access_key_id = ref('')
const secret_access_key = ref('')
const loading = ref(false)
const hasPhotos = ref(false)
const connected = ref(false)
const importSkipped = ref(false)

function selectMode(value: 'create' | 'connect') {
  mode.value = value
}

async function startImport() {
  try {
    await importPhotos()
  }
  catch (error) {
    addError(translateError(error))
  }
}

function skipImport() {
  importSkipped.value = true
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
      <template v-if="hasPhotos && !importSkipped && !result">
        <p>
          It looks like your bucket already has some image files in it. We can import them into
          Pictacular, auto-creating Albums from your folder structure.
        </p>

        <div v-if="importing" class="flex flex-col items-center gap-y-2">
          <p>
            Importing your photos… {{ progress?.imported ?? 0 }}<template v-if="progress?.total">
              / {{ progress.total }}
            </template>
          </p>
        </div>
        <div v-else class="flex justify-center gap-x-4">
          <button
            type="button"
            class="h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
            @click="startImport"
          >
            Import my existing photos
          </button>
          <button
            type="button"
            class="h-10 rounded bg-slate-200 px-4 font-medium dark:bg-slate-700"
            @click="skipImport"
          >
            Skip for now
          </button>
        </div>
      </template>

      <p v-else-if="result">
        Imported {{ result.imported }} photo{{ result.imported === 1 ? '' : 's' }} into
        {{ result.albums }} album{{ result.albums === 1 ? '' : 's' }}.
      </p>
      <p v-else>
        Your storage connection is ready.
      </p>

      <button
        v-if="!importing"
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
