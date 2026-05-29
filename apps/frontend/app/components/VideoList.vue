<script setup lang="ts">
import type { VideoProgress } from '@ypd/shared';

import VideoRow from './VideoRow.vue';

defineProps<{
  videoIds: string[];
  progress: Record<string, VideoProgress>;
}>();
</script>

<template>
  <ul class="video-list">
    <!-- Stable :key for incremental reconciliation; v-memo lives inside VideoRow so each row
         only re-renders when its own progress entry changes. -->
    <VideoRow v-for="id in videoIds" :key="id" :video-id="id" :progress="progress[id]" />
  </ul>
</template>

<style scoped>
.video-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  overflow: hidden;
}
</style>
