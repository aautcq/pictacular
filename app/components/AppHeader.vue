<script setup lang="ts">
const { isAuthenticated, fullName, logout } = useCurrentUser()
const { t } = useI18n({ useScope: 'global' })

async function handleLogout() {
  await logout()
  await navigateTo('/login')
}
</script>

<template>
  <header class="fixed inset-x-0 top-0 z-20 h-12 bg-gray-200 dark:bg-gray-900">
    <nav class="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
      <NuxtLink to="/" class="font-semibold text-gray-900 dark:text-gray-100">
        Pictacular
      </NuxtLink>

      <div class="flex items-center gap-4">
        <template v-if="isAuthenticated">
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
            <UButton
              to="/profile"
              color="neutral"
              active-color="success"
              variant="soft"
              :aria-label="fullName"
              icon="ph:user"
            />
          </UTooltip>
          <UTooltip :text="t('common.nav.logOut')">
            <UButton
              type="button"
              color="neutral"
              variant="soft"
              icon="ph:power"
              :aria-label="t('common.nav.logOut')"
              @click="handleLogout"
            />
          </UTooltip>
        </template>
        <UTooltip v-else :text="t('common.nav.signIn')">
          <UButton
            to="/login"
            color="neutral"
            variant="soft"
            icon="ph:power"
            :aria-label="t('common.nav.signIn')"
          />
        </UTooltip>
      </div>
    </nav>
  </header>
</template>
