<script setup lang="ts">
import type { AlbumFull } from '~/composables/useAlbums'

const album = defineModel<AlbumFull>({ required: true })
const isOpen = defineModel<boolean>('isOpen', { required: true })

const { user } = useCurrentUser()
const { addCollaborators, removeCollaborator } = useAlbums()
const toast = useToast()
const { translateError, getFieldErrors } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const form = useTemplateRef('form')
const inviteEmailsText = shallowRef('')
const inviting = shallowRef(false)
const removingCollaboratorId = shallowRef<number | null>(null)

function parseEmails(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map(email => email.trim())
    .filter(email => email.length > 0)
}

// Bound to `<UForm :state>`'s `emails` field so it validates against
// `albumCollaboratorsSchema` ({ emails: string[] }) while the textarea
// itself keeps editing/displaying the comma/newline-separated raw text.
const emails = computed<string[]>({
  get: () => parseEmails(inviteEmailsText.value),
  set: (value) => {
    inviteEmailsText.value = value.join(', ')
  },
})

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)

// Issue #52: the add-Collaborators endpoint distinguishes an email that
// was linked immediately (an existing User) from one that was invited
// instead (no account yet) — so the toast reports the actual outcome
// rather than a single "Invitation sent." for both cases.
function describeInviteResult({ linked, invited }: { linked: string[], invited: string[] }) {
  const parts: string[] = []
  if (linked.length)
    parts.push(t('collaboratorsAdded', linked.length))
  if (invited.length)
    parts.push(t('invitationsSent', invited.length))

  const message = parts.join(` ${t('and')} `)
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`
}

async function submitInvite() {
  if (!emails.value.length)
    return

  inviting.value = true
  try {
    const result = await addCollaborators(album.value.id, emails.value)
    album.value = result
    inviteEmailsText.value = ''
    toast.add({ title: describeInviteResult(result) })
  }
  catch (error) {
    form.value?.setErrors(getFieldErrors(error))
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    inviting.value = false
  }
}

async function removeCollaboratorFromAlbum(userId: number) {
  removingCollaboratorId.value = userId
  try {
    album.value = await removeCollaborator(album.value.id, userId)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    removingCollaboratorId.value = null
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="t('collaboratorsButton')"
  >
    <template #body>
      <ul class="flex flex-col gap-y-2">
        <li class="flex items-center justify-between gap-x-2">
          <span>{{ album?.admin.first_name }} {{ album?.admin.last_name }} <span class="text-xs text-gray-500 dark:text-gray-300">({{ t('admin') }})</span></span>
        </li>
      </ul>

      <ul v-if="album?.collaborators.length" class="flex flex-wrap gap-2">
        <li
          v-for="collaborator in album.collaborators"
          :key="collaborator.id"
          class="flex items-center gap-x-2 rounded-full bg-gray-100 py-1 pl-1 pr-2 dark:bg-gray-800"
        >
          <UAvatar
            :src="collaborator.avatar_url ?? undefined"
            :alt="`${collaborator.first_name} ${collaborator.last_name}`"
            size="xs"
          />
          <span class="text-sm">{{ collaborator.first_name }} {{ collaborator.last_name }}</span>
          <button
            v-if="isAdmin"
            type="button"
            :title="t('removeCollaboratorTitle')"
            :disabled="removingCollaboratorId === collaborator.id"
            class="flex h-5 w-5 items-center justify-center rounded-full text-red-500 hover:bg-gray-200 disabled:opacity-50 dark:hover:bg-gray-700"
            @click="removeCollaboratorFromAlbum(collaborator.id)"
          >
            <Icon name="ph:x-bold" />
          </button>
        </li>
      </ul>

      <UForm
        v-if="isAdmin"
        ref="form"
        class="space-y-2"
        :schema="albumCollaboratorsSchema"
        :state="{ emails }"
        :validate-on="['blur']"
        @submit.prevent="submitInvite"
      >
        <UFormField :label="t('inviteByEmailLabel')" name="emails">
          <UInput
            v-model="inviteEmailsText"
            type="text"
            autofocus
            :placeholder="t('inviteByEmailPlaceholder')"
            autocomplete="off"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          :disabled="!inviteEmailsText.trim()"
          :loading="inviting"
          block
          :label="inviting ? t('inviting') : t('inviteButton')"
        />
      </UForm>
    </template>

    <template #footer="{ close }">
      <UButton
        type="button"
        :label="t('done')"
        color="neutral"
        variant="soft"
        @click="close"
      />
    </template>
  </UModal>
</template>

<i18n lang="json">
{
  "en": {
    "collaboratorsButton": "Collaborators",
    "admin": "admin",
    "removeCollaboratorTitle": "Remove collaborator",
    "inviteByEmailLabel": "Invite by email",
    "inviteByEmailPlaceholder": "jane{'@'}example.com, john{'@'}example.com",
    "inviting": "Inviting…",
    "inviteButton": "Invite",
    "done": "Done",
    "collaboratorsAdded": "{count} collaborator added | {count} collaborators added",
    "invitationsSent": "{count} invitation sent | {count} invitations sent",
    "and": "and"
  }
}
</i18n>
