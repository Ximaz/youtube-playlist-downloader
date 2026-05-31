<script setup lang="ts">
import type { VideoProgress, VideoStep } from '@ypd/shared';
import { computed } from 'vue';

const props = defineProps<{
  index: number; // 1-based
  videoId: string;
  progress: VideoProgress | undefined;
  /** Title known at playlist-load time; shown until the live progress title arrives. */
  fallbackTitle?: string;
  ext: string;
}>();

interface StatusDef {
  label: string;
  dot: string; // dot bg color class
  active?: boolean; // pulse + counts as in-flight
  bar: string; // fill color class
  full?: boolean; // bar sits at 100% regardless of pct
}

// Maps the real VideoStep set (incl. cached/failed/unavailable, which the spec doesn't
// cover) onto the spec's calm dot + bar palette (§6.7).
const STATUS: Record<VideoStep, StatusDef> = {
  queued: { label: 'Queued', dot: 'bg-ink-faint', bar: 'bg-track' },
  download: { label: 'Downloading', dot: 'bg-accent', active: true, bar: 'bg-accent' },
  convert: { label: 'Converting', dot: 'bg-convert', active: true, bar: 'bg-convert' },
  done: { label: 'Done', dot: 'bg-done', bar: 'bg-done', full: true },
  cached: { label: 'Cached', dot: 'bg-done', bar: 'bg-done', full: true },
  failed: { label: 'Failed', dot: 'bg-ink-soft', bar: 'bg-ink-faint', full: true },
  unavailable: { label: 'Unavailable', dot: 'bg-ink-faint', bar: 'bg-ink-faint', full: true },
};

const step = computed<VideoStep>(() => props.progress?.step ?? 'queued');
const status = computed(() => STATUS[step.value]);
const idxLabel = computed(() => String(props.index).padStart(2, '0'));
const title = computed(() => props.progress?.title ?? props.fallbackTitle ?? props.videoId);
const isMeasured = computed(() => step.value === 'download' || step.value === 'convert');

const fillWidth = computed(() => {
  if (status.value.full) return '100%';
  if (isMeasured.value) return `${props.progress?.pct ?? 0}%`;
  return '0%';
});
const pctLabel = computed(() => {
  if (status.value.full)
    return step.value === 'failed' || step.value === 'unavailable' ? '—' : '100%';
  if (isMeasured.value) return `${props.progress?.pct ?? 0}%`;
  return '—';
});
</script>

<template>
  <li
    v-memo="[step, progress?.pct, progress?.title, progress?.error]"
    class="flex items-center gap-4 rounded-[11px] px-3 py-3.25 transition-colors hover:bg-paper max-[680px]:gap-3"
  >
    <!-- Index -->
    <span class="w-6 shrink-0 text-right font-mono text-[12px] text-ink-faint">{{ idxLabel }}</span>

    <!-- Main -->
    <div class="flex min-w-0 flex-1 flex-col gap-2.5">
      <div class="flex items-center gap-2.5">
        <span class="truncate text-[14px] font-medium text-ink">{{ title }}</span>
        <span class="shrink-0 rounded bg-track px-1.5 py-0.5 font-mono text-[10.5px] text-ink-soft">
          .{{ ext }}
        </span>
      </div>
      <div class="h-1.25 overflow-hidden rounded-[20px] bg-track">
        <div
          class="h-full rounded-[20px] transition-[width] duration-300 ease-out"
          :class="status.bar"
          :style="{ width: fillWidth }"
        ></div>
      </div>
      <p v-if="progress?.error" class="truncate text-[12px] text-accent-ink">
        {{ progress.error }}
      </p>
    </div>

    <!-- Status -->
    <div class="flex w-30.5 shrink-0 items-center justify-end gap-2.5 max-[680px]:w-24">
      <span class="flex items-center gap-2">
        <span
          class="size-1.5 rounded-full"
          :class="[status.dot, status.active && 'animate-dot']"
        ></span>
        <span class="text-[12px] text-ink-soft">{{ status.label }}</span>
      </span>
      <span class="w-9 text-right font-mono text-[11.5px] text-ink-faint">{{ pctLabel }}</span>
    </div>
  </li>
</template>
