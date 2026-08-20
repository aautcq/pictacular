<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const { fullName } = useCurrentUser()
</script>

<template>
  <div class="flex flex-col items-center gap-y-4 py-20 text-center">
    <h1 class="text-xl font-semibold">
      Welcome, {{ fullName }}
    </h1>
    <p class="text-slate-600 dark:text-slate-300">
      Your photo library isn't built yet — check back soon.
    </p>
  </div>
</template>
