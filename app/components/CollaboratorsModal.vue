<script setup lang="ts">
import type { CommandPaletteItem } from '@nuxt/ui'
import type { AlbumFull, CollaboratorSuggestion } from '~/composables/useAlbums'
import { z } from 'zod'

const album = defineModel<AlbumFull>({ required: true })
const isOpen = defineModel<boolean>('isOpen', { required: true })

const { user } = useCurrentUser()
const { addCollaborators, removeCollaborator, searchCollaboratorSuggestions } = useAlbums()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const inviting = shallowRef(false)
const removingCollaboratorId = shallowRef<number | null>(null)

// Issue #171 / ADR 0012: the typeahead only ever suggests Users the admin
// already collaborates with elsewhere — a suggestion item carries its
// email directly so inviteItem doesn't need a follow-up lookup. Kept as
// a plain interface (not `extends CommandPaletteItem`) — that generic type
// pushed the TS compiler past its instantiation-depth limit once combined
// with the computed arrays below; CommandPaletteItem's own index
// signature makes it structurally compatible regardless.
interface InviteItem {
  id: string
  label: string
  email: string
  icon?: string
  suffix?: string
  avatar?: { src?: string, alt?: string }
}

const searchTerm = shallowRef('')
const searching = shallowRef(false)
const suggestions = shallowRef<CollaboratorSuggestion[]>([])

watchDebounced(searchTerm, async (term) => {
  if (!album.value)
    return

  searching.value = true
  try {
    suggestions.value = await searchCollaboratorSuggestions(album.value.id, term)
  }
  finally {
    searching.value = false
  }
}, { debounce: 250 })

// Reset all invite-search state whenever the modal closes, so reopening
// it (possibly for a different Album) never shows a stale search.
watch(isOpen, (open) => {
  if (!open) {
    searchTerm.value = ''
    suggestions.value = []
  }
})

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)

const suggestionItems = computed<InviteItem[]>(() => suggestions.value
  .map(suggestion => ({
    id: `user:${suggestion.id}`,
    label: `${suggestion.first_name} ${suggestion.last_name}`,
    suffix: suggestion.email,
    email: suggestion.email,
    avatar: { src: suggestion.avatar_url ?? undefined, alt: `${suggestion.first_name} ${suggestion.last_name}` },
  })))

// A first-ever invitee never appears as a suggestion (see ADR 0012), so a
// query that already looks like a full email — and isn't already
// suggested — is offered as a free-text "invite this email" item,
// preserving the pre-typeahead invite-by-email flow.
const rawInviteItem = computed<InviteItem | null>(() => {
  const term = searchTerm.value.trim()
  if (!z.email().safeParse(term).success)
    return null
  if (suggestionItems.value.some(item => item.email === term))
    return null

  return {
    id: `email:${term}`,
    label: t('inviteRawEmail', { email: term }),
    icon: 'ph:envelope-simple',
    email: term,
  }
})

const commandItems = computed<InviteItem[]>(() => rawInviteItem.value ? [...suggestionItems.value, rawInviteItem.value] : suggestionItems.value)

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

// Picking an item in the palette invites it right away (no separate
// submit step) — a single-email addCollaborators call per pick, rather
// than accumulating a batch.
async function inviteItem(value: CommandPaletteItem | undefined) {
  const item = value as InviteItem | undefined
  if (!item || inviting.value)
    return

  inviting.value = true
  try {
    const result = await addCollaborators(album.value.id, [item.email])
    album.value = result
    toast.add({ title: describeInviteResult(result) })
    searchTerm.value = ''
    suggestions.value = suggestions.value.filter(suggestion => suggestion.email !== item.email)
  }
  catch (error) {
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
  <UModal v-model:open="isOpen" :title="t('collaboratorsButton')">
    <template #body>
      <ul v-if="album?.collaborators.length" class="flex flex-wrap gap-2 mb-5">
        <li v-if="!isAdmin" class="flex items-center gap-x-2 rounded-full bg-gray-100 py-1 pl-1 pr-2 dark:bg-gray-800">
          <UAvatar
            :src="album?.admin.avatar_url ?? undefined"
            :alt="`${album?.admin.first_name} ${album?.admin.last_name}`"
            size="xs"
          />
          <span class="text-sm">{{ album?.admin.first_name }} {{ album?.admin.last_name }}</span>
          <Icon name="ph:crown" size="1em" class="text-green-600 dark:text-green-400" />
        </li>
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

      <UFormField v-if="isAdmin" :label="t('inviteByEmailLabel')" name="emails">
        <UCommandPalette
          v-model:search-term="searchTerm"
          :loading="searching || inviting"
          :disabled="inviting"
          :groups="[{ id: 'invitees', items: commandItems, ignoreFilter: true }]"
          :placeholder="t('inviteSearchPlaceholder')"
          class="h-72"
          @update:model-value="inviteItem"
        >
          <template #empty>
            <p class="p-4 text-sm text-gray-500 dark:text-gray-400">
              {{ t('noSuggestions') }}
            </p>
          </template>
        </UCommandPalette>
      </UFormField>
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
    "inviteSearchPlaceholder": "Search by name or email…",
    "noSuggestions": "No matches. Type a full email address to invite someone new.",
    "inviteRawEmail": "Invite \"{email}\"",
    "done": "Done",
    "collaboratorsAdded": "{count} collaborator added | {count} collaborators added",
    "invitationsSent": "{count} invitation sent | {count} invitations sent",
    "and": "and"
  }
}
</i18n>
