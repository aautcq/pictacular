<script setup lang="ts">
import type { UploadItem } from '~/composables/usePhotoUpload'

defineProps<{ uploads: UploadItem[] }>()
</script>

<template>
  <div class="flex flex-col gap-y-2">
    <div v-for="item in uploads" :key="item.id" class="flex flex-col gap-y-1 rounded bg-gray-200 p-3 text-sm dark:bg-gray-900">
      <div class="flex items-center justify-between">
        <span class="truncate">{{ item.name }}</span>
        <span v-if="item.error" class="text-red-500">{{ item.error }}</span>
        <span v-else>{{ item.progress }}%</span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-300 dark:bg-gray-700">
        <div class="h-full bg-green-500 transition-all" :class="item.error && 'bg-red-500'" :style="{ width: `${item.progress}%` }" />
      </div>
    </div>
  </div>
</template>
