<script setup lang="ts">
defineProps<{
  modelValue: string
  label: string
  type?: string
  required?: boolean
  disabled?: boolean
  autocomplete?: string
}>()

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="flex w-full flex-col gap-y-1">
    <span class="text-sm text-slate-600 dark:text-slate-300">{{ label }}</span>
    <input
      :type="type"
      :value="modelValue"
      :required="required"
      :disabled="disabled"
      :autocomplete="autocomplete"
      class="h-10 w-full rounded border-none bg-white px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-50 dark:bg-slate-700"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
  </label>
</template>
