<script setup lang="ts">
// `$attrs` (class/style especially) are only meant to reach the inner
// `NuxtImg` below (via the explicit `v-bind="$attrs"`), not this
// component's own root div — without this, Vue's default attribute
// inheritance applies them to *both* elements, e.g. double-applying a
// caller's `transform` style (compounding any scale/translate).
defineOptions({ inheritAttrs: false })

const { width = 400, height = 400, fit = 'cover' } = defineProps<{
  src: string
  alt: string
  width?: number
  height?: number
  fit?: string
}>()

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
      :width
      :height
      :fit
      provider="photo"
      format="webp"
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
