<script setup lang="ts">
const { fetchCurrentUser } = useCurrentUser()

// Restore the session (if any) on load, so the header/route guards know
// the current auth state without waiting on a protected page's own fetch.
await callOnce('fetch-current-user', () => fetchCurrentUser())
</script>

<template>
  <UApp>
    <NuxtLayout>
      <template #header-actions>
        <NuxtPage name="header" />
      </template>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
