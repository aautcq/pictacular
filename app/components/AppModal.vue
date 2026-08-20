<script setup lang="ts">
const props = defineProps<{ name: string }>()

const { isOpen, close } = useModal(props.name)
const { trapRef, activate, deactivate } = useFocusTrap()

watch(isOpen, async (open) => {
  await nextTick()
  if (open)
    activate()
  else
    deactivate()
})
</script>

<template>
  <Transition name="modal-fade">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-30 flex items-center justify-center bg-slate-600/50"
      @click.self="close"
      @keydown.esc="close"
    >
      <div
        ref="trapRef"
        class="relative max-h-[80%] w-full overflow-y-auto rounded-md bg-slate-200 p-8 shadow-xl dark:bg-slate-800 md:w-1/2 xl:w-1/3"
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          title="Close"
          class="absolute right-0 top-0 p-3 focus-visible:outline-none"
          @click="close"
        >
          <Icon name="ph:x" size="1.25em" />
        </button>
        <slot />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
