<script setup lang="ts">
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')
const { isAuthenticated, fullName, logout } = useCurrentUser()
const router = useRouter()

function toggle() {
  colorMode.preference = isDark.value ? 'light' : 'dark'
}

async function handleLogout() {
  await logout()
  await router.push('/login')
}
</script>

<template>
  <header class="fixed inset-x-0 top-0 z-20 h-16 bg-slate-200 dark:bg-slate-800">
    <nav class="mx-auto flex h-full max-w-5xl items-center justify-between px-6">
      <NuxtLink to="/" class="font-semibold text-slate-900 dark:text-slate-100">
        Pictacular
      </NuxtLink>

      <div class="flex items-center gap-4">
        <button
          type="button"
          class="rounded px-2 py-1 text-sm hover:bg-slate-300 dark:hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
          @click="toggle"
        >
          <Icon :name="isDark ? 'ph:sun' : 'ph:moon'" />
        </button>

        <template v-if="isAuthenticated">
          <NuxtLink
            to="/profile"
            class="rounded px-2 py-1 text-sm hover:bg-slate-300 dark:hover:bg-slate-700"
          >
            {{ fullName }}
          </NuxtLink>
          <button
            type="button"
            class="rounded px-2 py-1 text-sm hover:bg-slate-300 dark:hover:bg-slate-700"
            @click="handleLogout"
          >
            Log out
          </button>
        </template>
        <NuxtLink
          v-else
          to="/login"
          class="rounded px-2 py-1 text-sm hover:bg-slate-300 dark:hover:bg-slate-700"
        >
          Sign in
        </NuxtLink>
      </div>
    </nav>
  </header>
</template>
