<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { connectStorage, checkBucket, user } = useCurrentUser()
const { importing, progress, result, etaSeconds, importPhotos } = useBucketImport()
const toast = useToast()
const { translateError, getFieldErrors } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const form = useTemplateRef('form')
const mode = shallowRef<'create' | 'connect' | null>(null)
const state = reactive({
  bucket: '',
  access_key_id: '',
  secret_access_key: '',
})
const loading = shallowRef(false)
const connected = shallowRef(user.value?.has_aws_credentials ?? false)
const importSkipped = shallowRef(false)

const noImportStatus: BucketStatus = { has_photos: false, import_in_progress: false, import_completed: false, imported: 0, albums: 0 }

const { data: bucketStatus } = useAsyncData(async () => {
  if (connected.value && !importSkipped.value) {
    return await checkBucket()
  }
  return noImportStatus
})

// Restores the right screen state from the server on every mount: this
// composable's own progress/result refs are ephemeral (lost on any
// reload — e.g. this tab being suspended across a laptop going to sleep
// during a long import — even though the import itself keeps running
// server-side), so a reload mid-import silently resumes it in place
// instead of abandoning it, and a reload after a completed import
// restores its summary instead of re-offering an import that already
// finished (bucketStatus.import_completed/import_in_progress + its last
// result are read straight from the same AwsCredentials row
// server/api/photos/import.post.ts persists to).
watchEffect(() => {
  if (!bucketStatus.value || result.value)
    return

  if (bucketStatus.value.import_completed)
    result.value = { imported: bucketStatus.value.imported, albums: bucketStatus.value.albums }
  else if (bucketStatus.value.import_in_progress && !importing.value)
    startImport()
})

function selectMode(value: 'create' | 'connect') {
  mode.value = value
}

async function startImport() {
  try {
    await importPhotos()
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
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
        ? { mode: 'create', access_key_id: state.access_key_id, secret_access_key: state.secret_access_key }
        : { mode: 'connect', access_key_id: state.access_key_id, secret_access_key: state.secret_access_key, bucket: state.bucket },
    )

    connected.value = true
    bucketStatus.value = mode.value === 'connect' ? await checkBucket() : noImportStatus
  }
  catch (error) {
    form.value?.setErrors(getFieldErrors(error))
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    loading.value = false
  }
}

const importResultText = computed(() => {
  if (!result.value)
    return ''

  return t('importResult', {
    photoCount: t('photoCount', result.value.imported),
    albumCount: t('albumCount', result.value.albums),
  })
})

const etaLabel = computed(() => {
  const seconds = etaSeconds.value
  if (seconds === null)
    return null

  if (seconds < 60)
    return t('etaLessThanMinute')

  if (seconds < 3600)
    return t('etaMinutes', Math.max(1, Math.ceil(seconds / 60)))

  return t('etaHours', Math.max(1, Math.ceil(seconds / 3600)))
})
</script>

<template>
  <AuthCard>
    <template #title>
      {{ t('title') }}
    </template>

    <div v-if="connected" class="flex flex-col items-center gap-y-6 text-center">
      <template v-if="bucketStatus?.has_photos && !importSkipped && !result">
        <p>
          {{ t('importPrompt') }}
        </p>

        <div v-if="importing" class="flex flex-col items-center gap-y-4 w-full">
          <p>
            {{ t('importingProgress') }}
          </p>
          <UProgress
            :model-value="progress?.imported ?? 0"
            :max="progress?.total"
          >
            <template #status>
              {{ progress?.imported ?? 0 }} / {{ progress?.total ?? 0 }}
            </template>
          </UProgress>
          <p v-if="etaLabel" class="text-sm text-gray-500 dark:text-gray-400">
            {{ etaLabel }}
          </p>
        </div>
        <div v-else-if="!bucketStatus?.import_in_progress" class="flex justify-center gap-x-4">
          <UButton
            type="button"
            :label="t('importButton')"
            variant="soft"
            @click="startImport"
          />
          <UButton
            type="button"
            :label="t('skipImport')"
            variant="soft"
            @click="skipImport"
          />
        </div>
      </template>

      <p v-else-if="result">
        {{ importResultText }}
      </p>
      <p v-else>
        {{ t('connectionReady') }}
      </p>

      <UButton
        v-if="!importing"
        :label="t('continue')"
        to="/"
      />
    </div>

    <div v-else class="flex flex-col gap-y-6">
      <div class="flex flex-col gap-y-3 text-sm text-gray-600 dark:text-gray-300">
        <p>
          {{ t('description') }}
        </p>
      </div>

      <div class="flex justify-center gap-x-4">
        <UButton
          type="button"
          :active="mode === 'create'"
          variant="soft"
          active-variant="solid"
          color="neutral"
          active-color="success"
          :label="t('createBucket')"
          @click="selectMode('create')"
        />
        <UButton
          type="button"
          :active="mode === 'connect'"
          variant="soft"
          active-variant="solid"
          color="neutral"
          active-color="success"
          :label="t('connectBucket')"
          @click="selectMode('connect')"
        />
      </div>

      <UForm
        v-if="mode"
        ref="form"
        class="space-y-4"
        :schema="storageConnectionSchema"
        :state="{ mode, ...state }"
        @submit.prevent="submit"
      >
        <UFormField v-if="mode === 'connect'" :label="t('bucketNameLabel')" name="bucket">
          <UInput
            v-model="state.bucket"
            type="text"
            autocomplete="off"
            autofocus
            required
            :placeholder="t('bucketPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('accessKeyLabel')" name="access_key_id">
          <BasePasswordInput
            v-model="state.access_key_id"
            autocomplete="off"
            required
            :placeholder="t('accessKeyPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('secretKeyLabel')" name="secret_access_key">
          <BasePasswordInput
            v-model="state.secret_access_key"
            autocomplete="off"
            required
            :placeholder="t('secretKeyPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UButton
          type="submit"
          :loading="loading"
          :label="loading ? t('connecting') : t('connect')"
          block
        />
      </UForm>
    </div>
  </AuthCard>
</template>

<i18n lang="json">
{
  "en": {
    "title": "Connect your storage",
    "importPrompt": "It looks like your bucket already has some image files in it. We can import them into Pictacular, auto-creating Albums from your folder structure.",
    "importingProgress": "Importing your photos…",
    "etaLessThanMinute": "Less than a minute remaining",
    "etaMinutes": "About {count} minute remaining | About {count} minutes remaining",
    "etaHours": "About {count} hour remaining | About {count} hours remaining",
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
    "bucketPlaceholder": "Enter your bucket name",
    "accessKeyLabel": "Access key ID",
    "accessKeyPlaceholder": "Enter your access key ID",
    "secretKeyLabel": "Secret access key",
    "secretKeyPlaceholder": "Enter your secret access key",
    "connecting": "Connecting…",
    "connect": "Connect"
  }
}
</i18n>
