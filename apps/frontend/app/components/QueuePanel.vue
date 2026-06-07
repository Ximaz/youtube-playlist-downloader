<script setup lang="ts">
import { computed } from 'vue';

import type { UseDownloadBatch } from '../composables/useDownloadBatch';
import { outputExt } from '../lib/recipe';
import VideoRow from './VideoRow.vue';

const props = defineProps<{
  download: UseDownloadBatch;
  videoIds: string[];
  /** videoId → title known at playlist-load time, so rows show titles immediately instead of
   *  raw ids (the live `video:progress` title takes over once a download starts). */
  videoTitles: Record<string, string>;
  playlistTitle: string | null;
}>();

const toast = useToast();
const d = props.download;

// Ext reflects the *running job* (snapshotted per-video at start), not the live console
// toggles — read it off any progress entry, falling back to the current selection/format.
const sample = computed(() => Object.values(d.progress.value)[0]);
const ext = computed(() =>
  sample.value
    ? outputExt(sample.value.selection, sample.value.format)
    : outputExt(d.selection.value, d.format.value),
);

const rendered = computed(() => props.videoIds.length);
const title = computed(() => props.playlistTitle ?? 'Playlist');

// Overall % — the spec's weighted aggregate (§7): conversion jobs count as two phases, so a
// downloaded-but-not-converted item is only halfway. Terminal states contribute a full 1.
const overall = computed(() => {
  const ids = props.videoIds;
  if (!ids.length) return 0;
  let sum = 0;
  for (const id of ids) {
    const p = d.progress.value[id];
    const step = p?.step ?? 'queued';
    const convert = p ? p.format === 'converted' : d.format.value === 'converted';
    const phases = convert ? 2 : 1;
    const pct = p?.pct ?? 0;
    if (step === 'done' || step === 'cached' || step === 'failed' || step === 'unavailable')
      sum += 1;
    else if (step === 'convert') sum += (1 + pct / 100) / phases;
    else if (step === 'download') sum += pct / 100 / phases;
  }
  return Math.round((100 * sum) / ids.length);
});

const meta = computed(
  () => `${d.terminalCount.value} / ${rendered.value} complete · .${ext.value}`,
);

const archiveHref = computed(() => d.archiveHref.value);
const slug = computed(
  () =>
    title.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'playlist',
);

function onZip(): void {
  // The archive holds only the videos that succeeded — failed/unavailable ones are left
  // out — so report the success count, not the full rendered list.
  const files = d.successCount.value;
  toast.add({
    title: 'Archive downloading',
    description: `${slug.value}.zip · ${files} file${files === 1 ? '' : 's'}`,
    color: 'primary',
  });
}
</script>

<template>
  <section class="animate-rise rounded-[18px] border border-line bg-paper-2 shadow-paper-sm">
    <!-- Head -->
    <div class="flex items-start gap-4 px-7 pt-6.5 pb-5 max-[680px]:flex-col">
      <div class="min-w-0 flex-1">
        <span class="font-mono text-[11px] tracking-[0.16em] text-ink-faint uppercase">
          Download queue
        </span>
        <h3 class="mt-1 truncate font-display text-[22px] font-bold text-ink">{{ title }}</h3>
        <p class="mt-1 font-mono text-[12px] text-ink-faint">{{ meta }}</p>
      </div>

      <!-- ZIP button: real archive download when ready (§6.7) -->
      <a
        v-if="archiveHref"
        :href="archiveHref"
        download
        class="inline-flex items-center justify-center gap-2 rounded-[12px] bg-accent px-4 py-2.5 text-[14px] font-semibold text-white shadow-paper-sm transition hover:-translate-y-px hover:bg-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-[680px]:w-full"
        @click="onZip"
      >
        <svg
          class="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
          <path d="m3 8 9 5 9-5M12 13v8" />
        </svg>
        Download ZIP
      </a>
      <span
        v-else
        class="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-[12px] border border-line bg-track px-4 py-2.5 text-[14px] font-semibold text-ink-faint max-[680px]:w-full"
        aria-disabled="true"
      >
        <svg
          class="size-4.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
          <path d="m3 8 9 5 9-5M12 13v8" />
        </svg>
        Download ZIP
      </span>
    </div>

    <!-- Overall progress -->
    <div class="px-7" aria-live="polite">
      <div class="flex items-center gap-3">
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
          <div
            class="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            :style="{ width: `${overall}%` }"
          ></div>
        </div>
        <span class="w-10 text-right font-mono text-[12px] text-ink-soft">{{ overall }}%</span>
      </div>
    </div>

    <!-- Reconnect notice -->
    <p
      v-if="download.wsConnected.value === false"
      class="mx-7 mt-3 rounded-[10px] bg-accent-tint px-3 py-2 font-mono text-[11.5px] text-accent-ink"
    >
      Live updates paused · reconnecting…
    </p>

    <!-- Video list -->
    <ul class="px-4 pt-3.5 pb-5.5">
      <VideoRow
        v-for="(id, i) in videoIds"
        :key="id"
        :index="i + 1"
        :video-id="id"
        :progress="download.progress.value[id]"
        :fallback-title="videoTitles[id]"
        :ext="ext"
      />
    </ul>
  </section>
</template>
