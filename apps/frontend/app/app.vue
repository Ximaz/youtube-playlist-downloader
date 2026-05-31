<script setup lang="ts">
import AppShell from './components/AppShell.vue';
</script>

<template>
  <!-- UApp provides the toast/tooltip/overlay portals + global Nuxt UI config so any
       descendant can call useToast(). Replaces the former Naive provider stack. -->
  <UApp>
    <AppShell />
  </UApp>
</template>
