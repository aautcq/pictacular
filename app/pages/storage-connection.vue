<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { connectStorage, checkBucket, user } = useCurrentUser()
const { importing, progress, result, importPhotos } = useBucketImport()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const mode = shallowRef<'create' | 'connect' | null>(null)
const bucket = shallowRef('')
const access_key_id = shallowRef('')
const secret_access_key = shallowRef('')
const loading = shallowRef(false)
const connected = shallowRef(user.value?.has_aws_credentials ?? false)
const importSkipped = shallowRef(false)

const { data: hasPhotos } = useAsyncData(async () => {
  if (connected.value && !importSkipped.value) {
    return await checkBucket()
  }
  return false
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
        ? { mode: 'create', access_key_id: access_key_id.value, secret_access_key: secret_access_key.value }
        : { mode: 'connect', access_key_id: access_key_id.value, secret_access_key: secret_access_key.value, bucket: bucket.value },
    )

    connected.value = true
    hasPhotos.value = mode.value === 'connect' ? await checkBucket() : false
  }
  catch (error) {
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
        </div>
        <div v-else class="flex justify-center gap-x-4">
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
        class="space-y-4"
        :state="{ bucket, access_key_id, secret_access_key }"
        novalidate
        @submit.prevent="submit"
      >
        <UFormField v-if="mode === 'connect'" :label="t('bucketNameLabel')" name="bucket">
          <UInput
            v-model="bucket"
            type="text"
            autocomplete="off"
            autofocus
            required
            :placeholder="t('bucketPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('accessKeyLabel')" name="access_key_id">
          <UInput
            v-model="access_key_id"
            type="password"
            autocomplete="off"
            required
            :placeholder="t('accessKeyPlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('secretKeyLabel')" name="secret_access_key">
          <UInput
            v-model="secret_access_key"
            type="password"
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
