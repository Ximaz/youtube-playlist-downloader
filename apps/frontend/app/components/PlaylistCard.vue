<script setup lang="ts">
import type { OAuthPlaylistSummary } from '@ypd/shared';
import { computed } from 'vue';

const props = defineProps<{
  playlist: OAuthPlaylistSummary;
  index: number;
  loading: boolean;
}>();

defineEmits<{ (e: 'pick'): void }>();

const title = computed(() => props.playlist.title ?? props.playlist.id);
// Stagger entrance by index (§6.6).
const delay = computed(() => `${props.index * 0.04}s`);
</script>

<template>
  <button
    type="button"
    :disabled="loading"
    :aria-label="`Download ${title}`"
    :aria-busy="loading"
    class="group animate-rise block text-left focus-visible:outline-none disabled:cursor-wait"
    :style="{ animationDelay: delay }"
    @click="$emit('pick')"
  >
    <!-- Thumbnail -->
    <div
      class="relative aspect-video overflow-hidden rounded-[14px] bg-gradient-to-br from-track to-paper-2 shadow-paper-sm transition-[transform,box-shadow] duration-200 group-hover:-translate-y-1 group-hover:shadow-paper group-focus-visible:ring-2 group-focus-visible:ring-accent"
    >
      <img
        v-if="playlist.thumbnail"
        :src="playlist.thumbnail.url"
        :alt="title"
        loading="lazy"
        class="size-full object-cover"
      />

      <!-- Count badge -->
      <span
        class="absolute top-2.5 right-2.5 rounded-full border border-line-soft bg-white/80 px-2 py-0.5 font-mono text-[10.5px] text-ink-soft backdrop-blur"
      >
        {{ playlist.itemCount }} videos
      </span>

      <!-- Play glyph — fades out on hover -->
      <span
        class="absolute inset-0 grid place-items-center text-ink opacity-30 transition-opacity duration-200 group-hover:opacity-0"
      >
        <svg class="size-9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>

      <!-- Download affordance — springs in on hover -->
      <span
        class="absolute inset-0 grid place-items-center opacity-0 transition-[transform,opacity] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover:opacity-100"
      >
        <span
          class="grid size-13 scale-[0.78] place-items-center rounded-full bg-accent text-white shadow-paper transition-transform duration-300 ease-[cubic-bezier(.34,1.56,.64,1)] group-hover:scale-100"
        >
          <svg
            class="size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4v12m0 0 5-5m-5 5-5-5" />
            <path d="M5 20h14" />
          </svg>
        </span>
      </span>

      <!-- Resolving overlay -->
      <span v-if="loading" class="absolute inset-0 grid place-items-center bg-white/70">
        <svg
          class="size-7 animate-spin text-accent"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.22-8.56" stroke-linecap="round" />
        </svg>
      </span>
    </div>

    <!-- Info -->
    <div class="mt-2.5 px-0.5">
      <div class="truncate text-[15px] font-semibold text-ink">{{ title }}</div>
    </div>
  </button>
</template>
