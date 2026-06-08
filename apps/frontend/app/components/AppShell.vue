<script setup lang="ts">
import type { OAuthPlaylistSummary } from '@ypd/shared';
import { nextTick, onMounted, ref } from 'vue';

import { useAuth } from '../composables/useAuth';
import { useDownloadBatch } from '../composables/useDownloadBatch';
import { usePlaylistSource } from '../composables/usePlaylistSource';
import AppFooter from './AppFooter.vue';
import AppHeader from './AppHeader.vue';
import DownloadConsole from './DownloadConsole.vue';
import PlaylistsSection from './PlaylistsSection.vue';
import QueuePanel from './QueuePanel.vue';

const auth = useAuth();
const playlistSource = usePlaylistSource();
const download = useDownloadBatch();

const toast = useToast();
const queueEl = ref<HTMLElement | null>(null);

onMounted(async () => {
  try {
    await auth.init();
  } catch (err) {
    // /auth/me always 200s, so a throw here (after fetchMe's retries) is connectivity, never a
    // real sign-out — leave signedIn as null ("unknown", the same state as the initial load)
    // rather than falsely flipping to signed-out. The public paste/URL download flow still works.
    toast.add({
      title: 'Could not reach the server',
      description: asString(err),
      color: 'warning',
    });
  }
});

/** Smooth-scroll the queue into view once it has been rendered (§7 "scroll to it"). */
async function revealQueue(): Promise<void> {
  await nextTick();
  queueEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Console "Start download": resolve the active source (a playlist URL, or a pasted blob of
 *  video URLs) into a playlist, then start a job with the current recipe. */
async function onStart(): Promise<void> {
  download.reset();
  try {
    if (playlistSource.mode.value === 'paste') {
      const { ok, skipped } = playlistSource.buildFromUrls();
      if (!ok) {
        toast.add({
          title: 'No video URLs found',
          description: 'Paste at least one YouTube video URL — one per line.',
          color: 'error',
        });
        return;
      }
      if (skipped > 0) {
        toast.add({
          title: `${skipped} line${skipped === 1 ? '' : 's'} skipped`,
          description: 'Lines that were not recognized as a YouTube video URL.',
          color: 'warning',
        });
      }
    } else {
      const ok = await playlistSource.loadFromUrl();
      if (!ok) return;
    }
    if (!playlistSource.playlist.value) return;
    await download.start(playlistSource.playlist.value.videoIds);
    void revealQueue();
  } catch (err) {
    toast.add({ title: 'Could not start download', description: asString(err), color: 'error' });
  }
}

/** Playlist card click = "click to download" (§6.6): resolve the picked playlist's real
 *  videoIds, then immediately start a job using the console's current selection/format. */
async function onPickPlaylist(p: OAuthPlaylistSummary): Promise<void> {
  download.reset();
  try {
    const full = await auth.resolvePlaylist(p);
    if (!full) return; // superseded by a newer pick, or session ended
    playlistSource.setPlaylist({
      id: full.id,
      title: full.title,
      videoIds: full.videoIds,
      videoTitles: full.videoTitles,
    });
    await download.start(full.videoIds);
    void revealQueue();
  } catch (err) {
    toast.add({ title: 'Could not start download', description: asString(err), color: 'error' });
  }
}

async function onSignOut(): Promise<void> {
  try {
    await auth.signOut();
  } catch (err) {
    toast.add({ title: 'Sign-out failed', description: asString(err), color: 'error' });
    return;
  }
  playlistSource.clear();
  download.reset();
}

function asString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
</script>

<template>
  <div>
    <AppHeader
      :signed-in="auth.signedIn.value"
      :name="auth.profile.value?.name ?? null"
      :picture="auth.profile.value?.picture ?? null"
      @sign-out="onSignOut"
    />

    <main class="mx-auto max-w-280 px-7 pb-25 max-[680px]:px-4">
      <h1
        class="animate-rise pt-16.5 pb-2 font-display text-[clamp(28px,4.6vw,43px)] leading-[1.06] font-bold tracking-[-0.015em] text-ink"
      >
        Download &amp; convert any <em class="font-normal not-italic text-accent">playlist</em>, all
        at once.
      </h1>

      <DownloadConsole
        v-model:url="playlistSource.urlInput.value"
        v-model:urls="playlistSource.urlsInput.value"
        v-model:mode="playlistSource.mode.value"
        v-model:selection="download.selection.value"
        v-model:format="download.format.value"
        :loading="playlistSource.loading.value || download.checking.value"
        class="mt-8"
        @start="onStart"
      />

      <PlaylistsSection
        :signed-in="auth.signedIn.value"
        :playlists="auth.userPlaylists.value"
        :loading="auth.loadingPlaylists.value"
        :loading-playlist-id="auth.loadingPlaylistId.value"
        class="mt-16"
        @pick="onPickPlaylist"
      />

      <div v-if="download.started.value" ref="queueEl" class="mt-16 scroll-mt-24">
        <QueuePanel
          :download="download"
          :video-ids="
            playlistSource.playlist.value?.videoIds.length
              ? playlistSource.playlist.value.videoIds
              : download.videoIds.value
          "
          :video-titles="playlistSource.playlist.value?.videoTitles ?? {}"
          :playlist-title="playlistSource.playlist.value?.title ?? null"
        />
      </div>

      <AppFooter class="mt-20" />
    </main>
  </div>
</template>
