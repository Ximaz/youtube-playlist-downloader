<script setup lang="ts">
import type { MediaSelection, OutputFormat } from '@ypd/shared';
import { computed } from 'vue';

import { containerLabel } from '../lib/recipe';
import SegControl from './SegControl.vue';

const url = defineModel<string>('url', { required: true });
const selection = defineModel<MediaSelection>('selection', { required: true });
const format = defineModel<OutputFormat>('format', { required: true });

const props = defineProps<{ loading: boolean }>();
const emit = defineEmits<{ (e: 'start'): void }>();

const formatOptions = [
  { value: 'audio' as const, label: 'Audio', icon: 'audio' as const },
  { value: 'video' as const, label: 'Video', icon: 'video' as const },
  { value: 'merged' as const, label: 'Combined', icon: 'both' as const },
];

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
  if (props.loading) return;
  emit('start');
}
</script>

<template>
  <section
    class="animate-rise overflow-hidden rounded-[18px] border border-line bg-paper-2 shadow-paper-sm"
  >
    <div class="p-7">
      <!-- URL row -->
      <div class="flex gap-3 max-[680px]:flex-col">
        <label
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

        <button
          type="button"
          :disabled="loading"
          class="inline-flex items-center justify-center gap-2 rounded-[12px] bg-accent px-5 py-3 text-[14px] font-semibold text-white shadow-paper-sm transition hover:-translate-y-px hover:bg-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-70 max-[680px]:w-full"
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
