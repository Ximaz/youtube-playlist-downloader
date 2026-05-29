<script setup lang="ts">
import { NCard, NSpace, NText } from 'naive-ui';

import type { UseDownloadBatch } from '../composables/useDownloadBatch';
import type { UsePlaylistSource } from '../composables/usePlaylistSource';
import DownloadConfig from './DownloadConfig.vue';
import ProgressSummary from './ProgressSummary.vue';
import UrlInput from './UrlInput.vue';
import VideoList from './VideoList.vue';

/** The Download tab body. Receives the parent composables verbatim so all reactivity
 *  stays on the App.vue scope — re-mounting this pane (e.g. when the Library tab
 *  toggles in/out of the layout above it) doesn't reset any state. */
defineProps<{
  playlistSource: UsePlaylistSource;
  download: UseDownloadBatch;
}>();

defineEmits<{
  (e: 'load-url'): void;
  (e: 'download'): void;
}>();
</script>

<template>
  <n-space vertical :size="20">
    <n-card title="Playlist URL" size="small" :bordered="true">
      <UrlInput
        v-model:url-input="playlistSource.urlInput.value"
        :loading="playlistSource.loading.value"
        @load="$emit('load-url')"
      />
    </n-card>

    <template v-if="playlistSource.playlist.value">
      <n-card size="small" :bordered="true">
        <n-space align="center" justify="space-between" :wrap="false">
          <h2 class="playlist-title">
            {{ playlistSource.playlist.value.title ?? playlistSource.playlist.value.id }}
          </h2>
          <n-text depth="3">{{ playlistSource.playlist.value.videoIds.length }} videos</n-text>
        </n-space>
      </n-card>

      <DownloadConfig
        v-model:selection="download.selection.value"
        v-model:format="download.format.value"
        :disabled="download.checking.value || download.pending.value"
        :checking="download.checking.value"
        :pending="download.pending.value"
        @download="$emit('download')"
      />

      <ProgressSummary
        v-if="download.started.value"
        :started="download.started.value"
        :checking="download.checking.value"
        :total="download.total.value"
        :queued-count="download.queuedCount.value"
        :downloading-count="download.downloadingCount.value"
        :converting-count="download.convertingCount.value"
        :done-count="download.doneCount.value"
        :cached-count="download.cachedCount.value"
        :failed-count="download.failedCount.value"
        :unavailable-count="download.unavailableCount.value"
        :ws-connected="download.wsConnected.value"
        :archive-href="download.archiveHref.value"
      />

      <VideoList
        :video-ids="playlistSource.playlist.value.videoIds"
        :progress="download.progress.value"
      />
    </template>
  </n-space>
</template>

<style scoped>
.playlist-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
</style>
