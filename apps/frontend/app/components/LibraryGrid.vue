<script setup lang="ts">
import type { OAuthPlaylistSummary } from '@ypd/shared';
import { NCard, NEmpty, NSpace, NSpin, NText } from 'naive-ui';
import { computed } from 'vue';

const props = defineProps<{
  playlists: OAuthPlaylistSummary[] | null;
  loading: boolean;
  /** Which playlist is currently resolving its videoIds. */
  loadingPlaylistId: string | null;
}>();

defineEmits<{
  (e: 'pick', p: OAuthPlaylistSummary): void;
}>();

const isEmpty = computed(() => Array.isArray(props.playlists) && props.playlists.length === 0);
</script>

<template>
  <div v-if="loading" class="library-loading">
    <n-space align="center" :size="8">
      <n-spin size="medium" />
      <n-text depth="3">Loading your playlists…</n-text>
    </n-space>
  </div>

  <n-empty v-else-if="isEmpty" description="No playlists on this Google account." />

  <div v-else-if="playlists" class="library-grid">
    <!-- One card per playlist. v-memo on the loadingPlaylistId so the only re-render
         during a pick is the card whose spinner toggles. -->
    <n-card
      v-for="p in playlists"
      :key="p.id"
      v-memo="[p.id, p.title, p.itemCount, p.thumbnail?.url, loadingPlaylistId === p.id]"
      class="library-card"
      :class="{ 'library-card--loading': loadingPlaylistId === p.id }"
      hoverable
      role="button"
      :aria-disabled="loadingPlaylistId === p.id"
      :tabindex="loadingPlaylistId === p.id ? -1 : 0"
      @click="loadingPlaylistId === p.id ? undefined : $emit('pick', p)"
      @keyup.enter="loadingPlaylistId === p.id ? undefined : $emit('pick', p)"
    >
      <div class="library-card__thumb">
        <img v-if="p.thumbnail" :src="p.thumbnail.url" :alt="p.title ?? p.id" loading="lazy" />
        <div v-else class="library-card__placeholder">No cover</div>
        <div v-if="loadingPlaylistId === p.id" class="library-card__overlay">
          <n-spin />
        </div>
      </div>
      <div class="library-card__body">
        <div class="library-card__title">{{ p.title ?? p.id }}</div>
        <n-text depth="3" style="font-size: 12px">
          {{ p.itemCount }} item<template v-if="p.itemCount !== 1">s</template>
        </n-text>
      </div>
    </n-card>
  </div>
</template>

<style scoped>
.library-loading {
  padding: 24px;
  display: flex;
  justify-content: center;
}

.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.library-card {
  cursor: pointer;
  transition: transform 120ms ease;
}
.library-card:focus-visible {
  outline: 2px solid var(--n-primary-color, #3730a3);
  outline-offset: 2px;
}
.library-card--loading {
  cursor: wait;
  opacity: 0.85;
}
.library-card:hover:not(.library-card--loading) {
  transform: translateY(-2px);
}

:deep(.n-card__content) {
  padding: 0 !important;
}

.library-card__thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #f3f4f6;
  overflow: hidden;
}
.library-card__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.library-card__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 13px;
}
.library-card__overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

.library-card__body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.library-card__title {
  font-weight: 600;
  font-size: 14px;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
</style>
