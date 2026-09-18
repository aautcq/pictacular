<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { launchStorageConnection, confirmStorageConnection, checkBucket, user } = useCurrentUser()
const { importing, progress, result, etaSeconds, importPhotos } = useBucketImport()
const toast = useToast()
const { translateError, getFieldErrors } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const form = useTemplateRef('form')
const state = reactive({ mode: 'create' as 'create' | 'connect', aws_account_id: '', bucket: '' })
const launching = shallowRef(false)
const confirming = shallowRef(false)
const launchUrl = shallowRef<string | null>(null)
const pendingToken = shallowRef<string | null>(null)
const connected = shallowRef(user.value?.has_aws_credentials ?? false)
const importSkipped = shallowRef(false)

const noImportStatus: BucketStatus = { has_photos: false, import_in_progress: false, import_completed: false, imported: 0, albums: 0 }

// Radio options for the two onboarding modes (issue #152): switching mode
// clears any bucket name already typed, so a User who starts naming a
// bucket then switches back to "create a new bucket" doesn't silently
// submit a stale, unused value.
const modeItems = [
  { label: t('modeCreate'), value: 'create' as const },
  { label: t('modeConnect'), value: 'connect' as const },
]

watch(() => state.mode, () => {
  state.bucket = ''
})

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

async function launch() {
  launching.value = true
  try {
    const payload = state.mode === 'create'
      ? { mode: 'create' as const, aws_account_id: state.aws_account_id }
      : { mode: 'connect' as const, aws_account_id: state.aws_account_id, bucket: state.bucket }
    const response = await launchStorageConnection(payload)
    launchUrl.value = response.launch_url
    pendingToken.value = response.pending_token
  }
  catch (error) {
    form.value?.setErrors(getFieldErrors(error))
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    launching.value = false
  }
}

async function confirm() {
  if (!pendingToken.value)
    return

  confirming.value = true
  try {
    await confirmStorageConnection(pendingToken.value)
    connected.value = true
    // A freshly created bucket (mode "create") can never already contain
    // photos, so skip the round trip; a connected *existing* bucket
    // (mode "connect", issue #152) might, so it needs the real
    // `check-bucket` lookup to decide whether to offer the import step.
    bucketStatus.value = state.mode === 'connect' ? await checkBucket() : noImportStatus
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    confirming.value = false
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

      <div v-if="!launchUrl" class="flex flex-col gap-y-4">
        <UForm
          ref="form"
          class="space-y-4"
          :schema="storageConnectionLaunchSchema"
          :state="state"
          @submit.prevent="launch"
        >
          <UFormField :label="t('modeLabel')" name="mode">
            <URadioGroup v-model="state.mode" :items="modeItems" />
          </UFormField>

          <UFormField :label="t('accountIdLabel')" name="aws_account_id">
            <UInput
              v-model="state.aws_account_id"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              autofocus
              required
              :placeholder="t('accountIdPlaceholder')"
              class="w-full"
            />
          </UFormField>

          <UFormField v-if="state.mode === 'connect'" :label="t('bucketNameLabel')" name="bucket">
            <UInput
              v-model="state.bucket"
              type="text"
              autocomplete="off"
              required
              :placeholder="t('bucketNamePlaceholder')"
              class="w-full"
            />
          </UFormField>

          <UButton
            type="submit"
            :loading="launching"
            :label="launching ? t('launching') : t('launchStack')"
            block
          />
        </UForm>
      </div>

      <div v-else class="flex flex-col gap-y-4 items-center text-center">
        <p>
          {{ t('launchInstructions') }}
        </p>

        <UButton
          :label="t('openConsole')"
          :to="launchUrl"
          target="_blank"
          variant="soft"
        />

        <UButton
          type="button"
          :loading="confirming"
          :label="confirming ? t('confirming') : t('confirmLaunched')"
          @click="confirm"
        />
      </div>
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
    "description": "Pictacular stores your photos in your own AWS S3 bucket. Choose whether to create a new bucket or connect one you already own, enter your AWS Account ID, then launch a CloudFormation stack that sets up a Role Pictacular can use — no AWS keys are ever shared with Pictacular.",
    "modeLabel": "Bucket",
    "modeCreate": "Create a new bucket for me",
    "modeConnect": "Connect an existing bucket",
    "accountIdLabel": "AWS Account ID",
    "accountIdPlaceholder": "12-digit AWS Account ID",
    "bucketNameLabel": "Bucket name",
    "bucketNamePlaceholder": "Name of your existing bucket",
    "launchStack": "Launch Stack",
    "launching": "Preparing…",
    "launchInstructions": "A new tab opened the AWS CloudFormation Console with everything pre-filled — review and launch the stack there, then come back and confirm once it's finished.",
    "openConsole": "Open AWS Console",
    "confirmLaunched": "I've launched it, confirm connection",
    "confirming": "Confirming…"
  }
}
</i18n>
