<script setup lang="ts">
const { alerts, removeAlert } = useAlerts()
const { t } = useI18n()
</script>

<template>
  <ul class="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
    <TransitionGroup name="alert">
      <li
        v-for="alert in alerts"
        :key="alert.id"
        class="flex w-fit max-w-md items-center gap-3 rounded-lg border px-4 py-3 shadow-xl"
        :class="alert.type === 'success'
          ? 'border-green-500 bg-slate-100 text-green-900 dark:bg-slate-800 dark:text-green-100'
          : 'border-red-500 bg-slate-100 text-red-900 dark:bg-slate-800 dark:text-red-100'"
        role="status"
      >
        <Icon :name="alert.type === 'success' ? 'ph:check-circle' : 'ph:warning-circle'" class="flex-none" />
        <div class="flex-auto truncate">
          {{ alert.message }}
        </div>
        <button type="button" :title="t('common.close')" class="flex-none" @click="removeAlert(alert.id)">
          <Icon name="ph:x" />
        </button>
      </li>
    </TransitionGroup>
  </ul>
</template>

<style scoped>
.alert-enter-active,
.alert-leave-active,
.alert-move {
  transition: all 0.2s ease;
}
.alert-enter-from,
.alert-leave-to {
  opacity: 0;
  transform: translateX(1rem);
}
</style>
