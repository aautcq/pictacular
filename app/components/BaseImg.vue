<script setup lang="ts">
defineProps<{ src: string, alt: string }>()

const hasError = shallowRef(false)
const isLoaded = shallowRef(false)
</script>

<template>
  <div class="relative w-full h-full flex items-center justify-center">
    <NuxtImg
      v-if="!hasError"
      v-bind="$attrs"
      :src
      :alt
      format="webp"
      fit="cover"
      height="100%"
      width="100%"
      placeholder
      loading="lazy"
      class="h-full w-full object-cover"
      :class="[!isLoaded && 'hidden']"
      @error="hasError = true ; isLoaded = true"
      @load="isLoaded = true"
    />

    <div v-if="!isLoaded" class="flex flex-col items-center gap-y-2 text-gray-400 dark:text-gray-300">
      <Icon name="ph:spinner" size="2em" class="animate-spin" />
    </div>

    <div v-if="hasError" class="flex flex-col items-center gap-y-2 text-gray-400 dark:text-gray-300">
      <Icon name="ph:image" size="2em" />
      <p class="text-xs font-light">
        {{ alt }}
      </p>
    </div>
  </div>
</template>
