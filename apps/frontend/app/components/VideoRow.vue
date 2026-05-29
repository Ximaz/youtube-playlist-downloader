<script setup lang="ts">
import type { VideoProgress, VideoStep } from '@ypd/shared';
import { NProgress, NTag, NText } from 'naive-ui';
import { computed } from 'vue';

import { thumbnailUrl, watchUrl } from '../lib/api';

const props = defineProps<{
  videoId: string;
  progress: VideoProgress | undefined;
}>();

type TagType = 'default' | 'info' | 'success' | 'warning' | 'error';

interface BadgeDef {
  label: string;
  type: TagType;
  hint?: string;
}

const BADGE_TABLE: Record<VideoStep, BadgeDef> = {
  queued: { label: 'Queued', type: 'default' },
  download: { label: 'Downloading', type: 'info' },
  convert: { label: 'Converting', type: 'info' },
  done: { label: 'Ready', type: 'success' },
  cached: { label: 'Already in your library', type: 'info' },
  failed: { label: 'Failed', type: 'error' },
  unavailable: { label: 'Unavailable', type: 'warning', hint: 'Private or removed' },
};

const badge = computed<BadgeDef | null>(() =>
  props.progress ? BADGE_TABLE[props.progress.step] : null,
);
const badgeLabel = computed(() => {
  if (!badge.value || !props.progress) return '';
  const pct = props.progress.pct;
  const showPct =
    pct != null && (props.progress.step === 'download' || props.progress.step === 'convert');
  return showPct ? `${badge.value.label} ${pct}%` : badge.value.label;
});
const showInlineBar = computed(
  () =>
    !!props.progress &&
    (props.progress.step === 'download' || props.progress.step === 'convert') &&
    props.progress.pct != null,
);
const displayTitle = computed(() => props.progress?.title ?? props.videoId);
</script>

<template>
  <li class="video-row" v-memo="[progress?.step, progress?.pct, progress?.title, progress?.error]">
    <img
      :src="thumbnailUrl(videoId)"
      :alt="videoId"
      width="160"
      height="90"
      loading="lazy"
      class="video-row__thumb"
    />
    <div class="video-row__body">
      <a :href="watchUrl(videoId)" target="_blank" rel="noreferrer" class="video-row__title">
        {{ displayTitle }}
      </a>
      <div v-if="badge" class="video-row__meta">
        <n-tag :type="badge.type" size="small" round>{{ badgeLabel }}</n-tag>
        <n-text v-if="badge.hint" depth="3" style="font-size: 12px">{{ badge.hint }}</n-text>
      </div>
      <div v-if="showInlineBar" class="video-row__bar">
        <n-progress
          type="line"
          :percentage="progress?.pct ?? 0"
          :show-indicator="false"
          :height="4"
          :border-radius="2"
        />
      </div>
      <n-text v-if="progress?.error" type="error" style="font-size: 12px">
        {{ progress.error }}
      </n-text>
    </div>
  </li>
</template>

<style scoped>
.video-row {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #e5e7eb;
  list-style: none;
  align-items: flex-start;
}
.video-row:last-child {
  border-bottom: none;
}
.video-row__thumb {
  border-radius: 6px;
  flex-shrink: 0;
  object-fit: cover;
  background: #f3f4f6;
}
.video-row__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.video-row__title {
  color: #1f2328;
  text-decoration: none;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.video-row__title:hover {
  text-decoration: underline;
}
.video-row__meta {
  display: flex;
  gap: 8px;
  align-items: center;
}
.video-row__bar {
  max-width: 360px;
}
@media (max-width: 639px) {
  .video-row {
    flex-direction: column;
    gap: 8px;
  }
  .video-row__thumb {
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
  }
}
</style>
