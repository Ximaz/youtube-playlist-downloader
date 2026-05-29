<script setup lang="ts">
import { NButton, NLayoutHeader, NSpace, NSpin, NText } from 'naive-ui';
import { computed } from 'vue';

import { signInUrl } from '../lib/api';

defineProps<{
  signedIn: boolean | null;
}>();

defineEmits<{
  (e: 'sign-out'): void;
}>();

// signInUrl is a getter (reads from Nuxt runtime config) so we resolve it once per render.
const href = computed(() => signInUrl());
</script>

<template>
  <n-layout-header
    bordered
    style="padding: 12px 24px; background: #ffffff; border-bottom: 1px solid var(--n-border-color)"
  >
    <n-space justify="space-between" align="center" :wrap="false">
      <strong style="font-size: 16px; letter-spacing: 0.2px">YouTube Playlist Downloader</strong>
      <div>
        <n-space v-if="signedIn === null" align="center" :size="8">
          <n-spin size="small" />
          <n-text depth="3">Checking sign-in…</n-text>
        </n-space>
        <n-button v-else-if="signedIn === false" tag="a" :href="href" type="primary" ghost>
          Sign in with Google
        </n-button>
        <n-button v-else type="error" ghost @click="$emit('sign-out')">Sign out</n-button>
      </div>
    </n-space>
  </n-layout-header>
</template>
