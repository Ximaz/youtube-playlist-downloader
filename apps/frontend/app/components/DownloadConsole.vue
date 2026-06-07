<script setup lang="ts">
import type { MediaSelection, OutputFormat } from '@ypd/shared';
import { computed } from 'vue';

import type { PlaylistSourceMode } from '../composables/usePlaylistSource';
import { containerLabel } from '../lib/recipe';
import { normalizeUrlText } from '../lib/urls';
import SegControl from './SegControl.vue';

const url = defineModel<string>('url', { required: true });
const urls = defineModel<string>('urls', { required: true });
const mode = defineModel<PlaylistSourceMode>('mode', { required: true });
const selection = defineModel<MediaSelection>('selection', { required: true });
const format = defineModel<OutputFormat>('format', { required: true });

const props = defineProps<{ loading: boolean }>();
const emit = defineEmits<{ (e: 'start'): void }>();

const modeOptions = [
  { value: 'playlist' as const, label: 'Playlist URL' },
  { value: 'paste' as const, label: 'Paste URLs' },
];

const formatOptions = [
  { value: 'audio' as const, label: 'Audio', icon: 'audio' as const },
  { value: 'video' as const, label: 'Video', icon: 'video' as const },
  { value: 'merged' as const, label: 'Combined', icon: 'both' as const },
];

/** Paste mode needs at least one line to do anything; playlist mode lets the parse decide. */
const canStart = computed(() => mode.value !== 'paste' || urls.value.trim().length > 0);

/** Reflow a pasted blob to one URL per line (separators dropped), spliced at the caret so
 *  each pasted URL lands on its own line — §"it gets new-lined with one URL per line". */
function onPaste(e: ClipboardEvent): void {
  const chunk = normalizeUrlText(e.clipboardData?.getData('text') ?? '');
  if (!chunk) return; // only separators / empty — let the default paste run
  e.preventDefault();
  const el = e.target as HTMLTextAreaElement;
  const before = urls.value.slice(0, el.selectionStart ?? urls.value.length);
  const after = urls.value.slice(el.selectionEnd ?? urls.value.length);
  const lead = before && !before.endsWith('\n') ? '\n' : '';
  const tail = after && !after.startsWith('\n') ? '\n' : '';
  urls.value = before + lead + chunk + tail + after;
}

// The Output container names flip with the selected format family (§6.5).
const codecOptions = computed(() => [
  {
    value: 'original' as const,
    label: 'Original',
    em: containerLabel(selection.value, 'original'),
  },
  {
    value: 'converted' as const,
    label: 'Converted',
    em: containerLabel(selection.value, 'converted'),
  },
]);

function onSubmit(): void {
  if (props.loading || !canStart.value) return;
  emit('start');
}
</script>

<template>
  <section
    class="animate-rise overflow-hidden rounded-[18px] border border-line bg-paper-2 shadow-paper-sm"
  >
    <div class="p-7">
      <!-- Source toggle: a single playlist URL, or a pasted blob of video URLs (§ad-hoc playlist) -->
      <SegControl
        v-model="mode"
        :options="modeOptions"
        label="Source"
        group-name="Input source"
        class="mb-5"
      />

      <!-- Input row -->
      <div class="flex gap-3" :class="mode === 'paste' ? 'flex-col' : 'max-[680px]:flex-col'">
        <label
          v-if="mode === 'playlist'"
          class="flex flex-1 items-center gap-2.5 rounded-[12px] border border-line bg-field px-3.5 transition focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-tint"
        >
          <span class="sr-only">YouTube playlist URL</span>
          <svg
            class="size-4.5 shrink-0 text-ink-faint"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07L11.5 4.5" />
            <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07L12.5 19.5" />
          </svg>
          <input
            v-model="url"
            type="text"
            inputmode="url"
            placeholder="Paste a YouTube playlist URL (ex: https://youtube.com/playlist?list=...)"
            class="w-full bg-transparent py-3 font-mono text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            @keyup.enter="onSubmit"
          />
        </label>

        <!-- Paste mode: raw video URLs, one per line. No thumbnails — just the textarea. -->
        <label
          v-else
          class="flex flex-1 rounded-[12px] border border-line bg-field px-3.5 transition focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-tint"
        >
          <span class="sr-only">Video URLs, one per line</span>
          <textarea
            v-model="urls"
            rows="5"
            placeholder="Paste video URLs — one per line. Commas, spaces or semicolons are split automatically."
            class="w-full resize-y bg-transparent py-3 font-mono text-[13px] leading-[1.7] text-ink placeholder:text-ink-faint focus:outline-none"
            @paste="onPaste"
          ></textarea>
        </label>

        <button
          type="button"
          :disabled="loading || !canStart"
          class="inline-flex items-center justify-center gap-2 rounded-[12px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-paper-sm transition hover:-translate-y-px hover:bg-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70 max-[680px]:w-full"
          :class="{ 'self-end': mode === 'paste' }"
          @click="onSubmit"
        >
          <svg
            v-if="loading"
            class="size-4.5 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-6.22-8.56" stroke-linecap="round" />
          </svg>
          <svg
            v-else
            class="size-4.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
            <path d="M5 21h14" />
          </svg>
          {{ loading ? 'Starting…' : 'Start download' }}
        </button>
      </div>

      <!-- Options row -->
      <div class="mt-6 flex flex-wrap justify-around gap-y-5">
        <SegControl
          v-model="selection"
          :options="formatOptions"
          label="Format"
          group-name="Media format"
        />
        <SegControl
          v-model="format"
          :options="codecOptions"
          label="Output"
          group-name="Output codec"
        />
      </div>
    </div>
  </section>
</template>
