<template>
  <AppHeader>
    <template #actions>
      <slot name="header-actions" />
    </template>
  </AppHeader>
  <main class="container relative mx-auto mt-20 max-w-5xl px-6">
    <slot />
  </main>
</template>
