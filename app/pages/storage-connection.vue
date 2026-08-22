<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { connectStorage, checkBucket } = useCurrentUser()
const { importing, progress, result, importPhotos } = useBucketImport()
const { addError } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()
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

const importResultText = computed(() => {
  if (!result.value)
    return ''

  return t('importResult', {
    photoCount: t('photoCount', result.value.imported),
    albumCount: t('albumCount', result.value.albums),
  })
})
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <div v-if="connected" class="flex flex-col items-center gap-y-6 text-center">
      <template v-if="hasPhotos && !importSkipped && !result">
        <p>
          {{ t('importPrompt') }}
        </p>

        <div v-if="importing" class="flex flex-col items-center gap-y-2">
          <p>
            {{ t('importingProgress') }} {{ progress?.imported ?? 0 }}<template v-if="progress?.total">
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
            {{ t('importButton') }}
          </button>
          <button
            type="button"
            class="h-10 rounded bg-slate-200 px-4 font-medium dark:bg-slate-700"
            @click="skipImport"
          >
            {{ t('skipImport') }}
          </button>
        </div>
      </template>

      <p v-else-if="result">
        {{ importResultText }}
      </p>
      <p v-else>
        {{ t('connectionReady') }}
      </p>

      <button
        v-if="!importing"
        type="button"
        class="h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
        @click="continueToApp"
      >
        {{ t('continue') }}
      </button>
    </div>

    <div v-else class="flex flex-col gap-y-6">
      <div class="flex flex-col gap-y-3 text-sm text-slate-600 dark:text-slate-300">
        <p>
          {{ t('description') }}
        </p>
      </div>

      <div class="flex justify-center gap-x-4">
        <button
          type="button"
          class="h-10 rounded px-4 font-medium"
          :class="mode === 'create' ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-700'"
          @click="selectMode('create')"
        >
          {{ t('createBucket') }}
        </button>
        <button
          type="button"
          class="h-10 rounded px-4 font-medium"
          :class="mode === 'connect' ? 'bg-green-500 text-white' : 'bg-slate-200 dark:bg-slate-700'"
          @click="selectMode('connect')"
        >
          {{ t('connectBucket') }}
        </button>
      </div>

      <form v-if="mode" class="flex flex-col gap-y-4" @submit.prevent="submit">
        <AppFormField v-if="mode === 'connect'" v-model="bucket" :label="t('bucketNameLabel')" required autocomplete="off" />
        <AppFormField v-model="access_key_id" :label="t('accessKeyLabel')" type="password" required autocomplete="off" />
        <AppFormField v-model="secret_access_key" :label="t('secretKeyLabel')" type="password" required autocomplete="off" />

        <button
          type="submit"
          :disabled="loading"
          class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
        >
          {{ loading ? t('connecting') : t('connect') }}
        </button>
      </form>
    </div>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Connect your storage",
    "importPrompt": "It looks like your bucket already has some image files in it. We can import them into Pictacular, auto-creating Albums from your folder structure.",
    "importingProgress": "Importing your photos…",
    "importButton": "Import my existing photos",
    "skipImport": "Skip for now",
    "photoCount": "{count} photo | {count} photos",
    "albumCount": "{count} album | {count} albums",
    "importResult": "Imported {photoCount} into {albumCount}.",
    "connectionReady": "Your storage connection is ready.",
    "continue": "Continue",
    "description": "Pictacular stores your photos in your own AWS S3 bucket. Provide an AWS access key + secret key, then either create a new bucket for Pictacular or connect one you already have.",
    "createBucket": "Create a new bucket for me",
    "connectBucket": "I already have a bucket",
    "bucketNameLabel": "Bucket name",
    "accessKeyLabel": "Access key ID",
    "secretKeyLabel": "Secret access key",
    "connecting": "Connecting…",
    "connect": "Connect"
  }
}
</i18n>
