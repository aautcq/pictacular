<script setup lang="ts">
// Shared icon-toggle search box (issue #190), reused by the Albums,
// library, and Album pages: collapsed to a single icon button by default
// (their header rows have no spare room for an always-visible input,
// see index.vue/[id].vue's already-crowded header-actions slot), it
// expands into a debounced-search UInput when clicked. Purely the input
// chrome — the actual debounce/search-result state lives in useSearch,
// called by each page with its own searchFn.
const { modelValue, label, placeholder } = defineProps<{
  modelValue: string
  label: string
  placeholder: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Starts open when mounted with an already-non-empty query (e.g. a
// v-model bound to useSearch state that survived a client-only
// navigation) — otherwise the active filter would be invisible behind a
// closed icon.
const isOpen = shallowRef(!!modelValue)

function open() {
  isOpen.value = true
}

// Closes and clears on Escape (an explicit "cancel search") — but merely
// losing focus only closes it when there's no query typed, so clicking a
// search result (which blurs the input) never silently discards it.
function closeAndClear() {
  isOpen.value = false
  emit('update:modelValue', '')
}

function onBlur() {
  if (!modelValue)
    isOpen.value = false
}
</script>

<template>
  <UTooltip v-if="!isOpen" :text="label">
    <UButton
      type="button"
      icon="ph:magnifying-glass"
      color="neutral"
      variant="soft"
      :aria-label="label"
      @click="open"
    />
  </UTooltip>

  <label v-else class="flex items-center">
    <span class="sr-only">{{ label }}</span>
    <UInput
      :model-value="modelValue"
      type="search"
      variant="soft"
      autofocus
      :placeholder="placeholder"
      icon="ph:magnifying-glass"
      class="w-36 sm:w-64"
      @update:model-value="emit('update:modelValue', String($event))"
      @keyup.esc="closeAndClear"
      @blur="onBlur"
    />
  </label>
</template>
