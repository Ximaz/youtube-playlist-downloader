<script setup lang="ts">
import { NButton } from 'naive-ui';

defineProps<{
  /** Empty string when the archive isn't available yet (still rendering nothing). */
  href: string;
}>();
</script>

<template>
  <n-button v-if="href" tag="a" :href="href" type="success" size="large" block download>
    Download archive (.zip)
  </n-button>
</template>
