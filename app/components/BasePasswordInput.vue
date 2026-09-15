<script setup lang="ts">
const password = defineModel<string>({ required: true })

const passwordInputType = shallowRef('password')
</script>

<template>
  <UInput
    v-model="password"
    :type="passwordInputType"
    v-bind="$attrs"
    :ui="{ trailing: 'pe-1' }"
  >
    <template v-if="password?.length" #trailing>
      <UButton
        color="neutral"
        variant="link"
        size="sm"
        :icon="passwordInputType === 'password' ? 'ph:eye' : 'ph:eye-slash'"
        :aria-label="passwordInputType === 'password' ? 'Show password' : 'Hide password'"
        @click="passwordInputType = passwordInputType === 'password' ? 'text' : 'password'"
      />
    </template>
  </UInput>
</template>
