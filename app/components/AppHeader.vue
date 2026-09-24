<script setup lang="ts">
const { isAuthenticated, fullName, user } = useCurrentUser()
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <header class="fixed inset-x-0 top-0 z-20 h-12 bg-gray-200 dark:bg-gray-900">
    <nav class="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
      <NuxtLink to="/" class="flex items-center gap-x-2 font-semibold text-gray-900 dark:text-gray-100">
        <img src="/icon.svg" alt="" width="24" height="24" class="size-6 dark:invert">
        <span class="sr-only sm:not-sr-only">Pictacular</span>
      </NuxtLink>

      <div class="flex items-center gap-x-2">
        <template v-if="isAuthenticated">
          <slot name="actions" />

          <UTooltip :text="t('common.nav.albums')">
            <UButton
              to="/albums"
              color="neutral"
              active-color="success"
              variant="soft"
              icon="ph:folders"
              :aria-label="t('common.nav.albums')"
            />
          </UTooltip>

          <UTooltip :text="fullName">
            <NuxtLink
              v-slot="{ isActive }"
              to="/profile"
              :aria-label="fullName"
              class="ml-5 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:focus-visible:ring-neutral-600"
            >
              <UAvatar
                :src="user?.avatar_url ?? undefined"
                :alt="fullName"
                size="md"
                :color="isActive ? 'success' : 'neutral'"
              />
            </NuxtLink>
          </UTooltip>
        </template>
        <UTooltip v-else :text="t('common.nav.signIn')">
          <UButton
            to="/login"
            color="neutral"
            variant="soft"
            icon="ph:sign-in"
            :aria-label="t('common.nav.signIn')"
          />
        </UTooltip>
      </div>
    </nav>
  </header>
</template>
