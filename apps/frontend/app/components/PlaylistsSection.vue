<script setup lang="ts">
import type { OAuthPlaylistSummary } from '@ypd/shared';
import { computed } from 'vue';

import GoogleConnectButton from './GoogleConnectButton.vue';
import PlaylistCard from './PlaylistCard.vue';

const props = defineProps<{
  signedIn: boolean | null;
  playlists: OAuthPlaylistSummary[] | null;
  loading: boolean;
  loadingPlaylistId: string | null;
}>();

const emit = defineEmits<{ (e: 'pick', p: OAuthPlaylistSummary): void }>();

const connected = computed(() => props.signedIn === true);
const count = computed(() => props.playlists?.length ?? 0);

// #plSub copy (§6.6 / §11).
const sub = computed(() => {
  if (!connected.value) return 'connect google to load';
  if (props.loading) return 'loading your playlists…';
  return `${count.value} playlists · click to download`;
});
</script>

<template>
  <section>
    <div class="mb-5 flex items-baseline gap-3">
      <h2 class="font-display text-[22px] font-bold text-ink">Your playlists</h2>
      <span id="plSub" class="font-mono text-[11px] tracking-[0.04em] text-ink-faint uppercase">
        {{ sub }}
      </span>
    </div>

    <div id="plArea">
      <!-- Disconnected → compact, icon-less empty state -->
      <div
        v-if="!connected"
        class="flex flex-col items-center gap-4 rounded-[18px] border border-dashed border-line bg-paper-2/60 px-7 py-9.5 text-center"
      >
        <h3 class="font-display text-[19px] font-bold text-ink">Your playlists live here</h3>
        <p class="max-w-110 text-[14px] text-ink-soft">
          Connect your Google account to browse your saved YouTube playlists and one-click download
          any of them.
        </p>
        <GoogleConnectButton />
      </div>

      <!-- Connected + loading -->
      <div v-else-if="loading" class="flex justify-center py-12 text-ink-faint">
        <svg
          class="size-7 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-6.22-8.56" stroke-linecap="round" />
        </svg>
      </div>

      <!-- Connected, no playlists -->
      <p v-else-if="count === 0" class="py-12 text-center font-mono text-[12px] text-ink-faint">
        No playlists on this Google account.
      </p>

      <!-- Connected → grid -->
      <div v-else class="grid gap-5.5 [grid-template-columns:repeat(auto-fill,minmax(236px,1fr))]">
        <PlaylistCard
          v-for="(p, i) in playlists"
          :key="p.id"
          :playlist="p"
          :index="i"
          :loading="loadingPlaylistId === p.id"
          @pick="emit('pick', p)"
        />
      </div>
    </div>
  </section>
</template>
