<script setup lang="ts">
// Issue #157: the single "Continue with Google" entry point shared by
// login.vue and register.vue — one button/flow covers both sign-in and
// sign-up, since which one happens is determined server-side by whether a
// matching User already exists (see server/api/auth/google/callback.get.ts).
// Rendered as a real anchor (`external`, so NuxtLink never intercepts it
// for client-side routing) because Google's own consent screen requires a
// genuine top-level browser navigation, not a fetch call.
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <UButton
    to="/api/auth/google"
    external
    block
    color="neutral"
    variant="outline"
    icon="ph:google-logo"
    :label="t('common.continueWithGoogle')"
  />
</template>
