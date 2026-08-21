<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  label: string
  type?: string
  required?: boolean
  disabled?: boolean
  autocomplete?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// Hydration-safe value binding (issue #91 fallout): Vue's own `v-model`
// only protects `type="text"`/`textarea` elements from a hydration race
// where a fast actor (autofill, or a Playwright `.fill()` landing on the
// SSR-rendered DOM before Vue finishes its async plugin/middleware chain
// and mounts) types into the input *before* hydration runs — for those,
// Vue detects the live DOM value differs from the SSR default and syncs
// the model *from* the DOM instead of clobbering it. `type="email"`/
// `"password"` inputs aren't covered by that check, so a plain `:value`
// binding here would silently wipe out anything typed in that window.
// This custom directive reimplements the same "did the DOM value already
// change under us?" comparison for every input type.
const initialValueKey = Symbol('initialValue')
const vHydrationSafeValue = {
  created(el: HTMLInputElement & { [initialValueKey]?: string }) {
    // `defaultValue` mirrors the SSR-rendered `value` attribute and is
    // unaffected by any `.value` property writes that happened before
    // hydration (Playwright's `.fill()`, browser autofill, a fast typer).
    el[initialValueKey] = el.defaultValue
  },
  mounted(el: HTMLInputElement & { [initialValueKey]?: string }) {
    const initialValue = el[initialValueKey]
    delete el[initialValueKey]
    if (initialValue !== undefined && el.value !== initialValue)
      emit('update:modelValue', el.value)
    else
      el.value = props.modelValue
  },
  beforeUpdate(el: HTMLInputElement, { value }: { value: string }) {
    // Mirror `vModelText`'s guard: don't fight the user's own typing (or an
    // in-progress IME composition) by clobbering a focused field's value on
    // an unrelated re-render — only sync in from external model changes.
    if (el.value !== value && document.activeElement !== el)
      el.value = value
  },
}
</script>

<template>
  <label class="flex w-full flex-col gap-y-1">
    <span class="text-sm text-slate-600 dark:text-slate-300">{{ label }}</span>
    <input
      v-hydration-safe-value="modelValue"
      :type="type"
      :required="required"
      :disabled="disabled"
      :autocomplete="autocomplete"
      class="h-10 w-full rounded border-none bg-white px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-50 dark:bg-slate-700"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
  </label>
</template>
