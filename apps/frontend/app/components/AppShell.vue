<script setup lang="ts">
import type { OAuthPlaylistSummary } from '@ypd/shared';
import {
  NLayout,
  NLayoutContent,
  NTabPane,
  NTabs,
  type TabsInst,
  useLoadingBar,
  useMessage,
} from 'naive-ui';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { useAuth } from '../composables/useAuth';
import { useDownloadBatch } from '../composables/useDownloadBatch';
import { usePlaylistSource } from '../composables/usePlaylistSource';
import AppHeader from './AppHeader.vue';
import DownloadPane from './DownloadPane.vue';
import LibraryGrid from './LibraryGrid.vue';

const auth = useAuth();
const playlistSource = usePlaylistSource();
const download = useDownloadBatch();

const message = useMessage();
const loadingBar = useLoadingBar();

// Top-level tab. Only consulted when both tabs are visible (signed-in).
// Picking a playlist or loading a URL switches to 'download' automatically.
const activeTab = ref<'library' | 'download'>('library');

// --- legacy localStorage cleanup -----------------------------------------------------
// An earlier iteration auto-resumed in-flight batches on refresh. The behaviour clashed
// with the "let me pick selection/format before anything fires" workflow, so the feature
// was dropped. Old entries are swept on every boot so the storage stays clean.
{
  const ACTIVE_BATCH_PREFIX = 'ypd:active:';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k?.startsWith(ACTIVE_BATCH_PREFIX)) localStorage.removeItem(k);
  }
}

onMounted(async () => {
  loadingBar.start();
  try {
    await auth.init();
    loadingBar.finish();
  } catch (err) {
    auth.signedIn.value = false;
    loadingBar.error();
    message.error(`Failed to read sign-in state: ${asString(err)}`);
  }
});

// Auto-select Library tab the first time we learn the user is signed in (so signed-in
// users land on their playlists). Don't override a user-driven tab change afterwards.
const sawSignedInOnce = ref(false);
watch(
  () => auth.signedIn.value,
  (signed) => {
    if (signed === true && !sawSignedInOnce.value) {
      sawSignedInOnce.value = true;
      // Only auto-switch if no playlist is loaded yet — don't yank the user mid-batch.
      if (!playlistSource.playlist.value) activeTab.value = 'library';
    }
  },
  { immediate: true },
);

const showLibraryTab = computed(() => auth.signedIn.value === true);

const tabsRef = ref<TabsInst | null>(null);

/** Force Naive's NTabs to remeasure the underline indicator.
 *
 *  Why this is necessary: Naive computes the bar's left/width from the DOM bounding
 *  box of the active tab's <button> on mount. During a v-if-driven mount (showing
 *  the tabs only when signed-in), `NTabPane` children register themselves via the
 *  parent inject AFTER NTabs' own onMounted runs — so the first measurement happens
 *  before the active pane's label has a stable layout, and the bar caches a wrong
 *  position (often 0px width, "invisible" indicator). Clicking the tab triggers an
 *  internal re-measure, which is why the user could "fix" it by clicking.
 *
 *  Two `await nextTick()` calls: the first flushes Vue's render, the second gives
 *  the browser a chance to lay out (Naive's own measurement also uses nextTick, so
 *  ours must run strictly after). */
async function syncTabsBar(): Promise<void> {
  await nextTick();
  await nextTick();
  tabsRef.value?.syncBarPosition();
}

// Re-sync whenever the tabs reappear in the DOM (sign-in flow) or the active tab
// changes programmatically (post-pick auto-switch from library → download).
watch([showLibraryTab, activeTab], () => {
  void syncTabsBar();
});

async function onPickPlaylist(p: OAuthPlaylistSummary): Promise<void> {
  download.reset();
  try {
    const full = await auth.resolvePlaylist(p);
    if (!full) return; // superseded by a newer pick, or session ended
    // OAuthPlaylist → PlaylistMetadata (superset, optional author).
    playlistSource.setPlaylist({ id: full.id, title: full.title, videoIds: full.videoIds });
    activeTab.value = 'download';
  } catch (err) {
    message.error(`Failed to load playlist: ${asString(err)}`);
  }
}

async function onLoadUrl(): Promise<void> {
  download.reset();
  loadingBar.start();
  try {
    const ok = await playlistSource.loadFromUrl();
    loadingBar.finish();
    if (ok) activeTab.value = 'download';
  } catch (err) {
    loadingBar.error();
    message.error(`Failed to load playlist: ${asString(err)}`);
  }
}

async function onDownload(): Promise<void> {
  if (!playlistSource.playlist.value) return;
  try {
    await download.start(playlistSource.playlist.value.videoIds);
  } catch (err) {
    message.error(`Failed to start download: ${asString(err)}`);
  }
}

async function onSignOut(): Promise<void> {
  // Server-side sign-out first; only clear local state on success so a network failure
  // doesn't silently log the user out from the UI's POV.
  try {
    await auth.signOut();
  } catch (err) {
    message.error(`Sign-out failed: ${asString(err)}`);
    return;
  }
  playlistSource.clear();
  download.reset(); // also closes the socket via teardown
  // Reset the "auto-select Library on first sign-in" sentinel so the next sign-in
  // lands the user back on Library instead of staying on Download.
  sawSignedInOnce.value = false;
  activeTab.value = 'library';
}

function asString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
</script>

<template>
  <n-layout style="min-height: 100vh">
    <AppHeader :signed-in="auth.signedIn.value" @sign-out="onSignOut" />
    <n-layout-content>
      <main class="page">
        <!-- Render <n-tabs> only when there are actually two tabs to show. Toggling
             panes in/out of an existing <n-tabs> breaks Naive's underline indicator
             (it measures against the prior pane layout). Conditional rendering of
             the whole tabs wrapper sidesteps that entirely: signed-out users see
             the Download content directly, signed-in users get the tabs. -->
        <n-tabs
          v-if="showLibraryTab"
          ref="tabsRef"
          v-model:value="activeTab"
          type="line"
          animated
          size="large"
          pane-wrapper-style="padding-top: 16px"
        >
          <n-tab-pane name="library" tab="My Library">
            <LibraryGrid
              :playlists="auth.userPlaylists.value"
              :loading="auth.loadingPlaylists.value"
              :loading-playlist-id="auth.loadingPlaylistId.value"
              @pick="onPickPlaylist"
            />
          </n-tab-pane>
          <n-tab-pane name="download" tab="Download">
            <DownloadPane
              :playlist-source="playlistSource"
              :download="download"
              @load-url="onLoadUrl"
              @download="onDownload"
            />
          </n-tab-pane>
        </n-tabs>

        <DownloadPane
          v-else
          :playlist-source="playlistSource"
          :download="download"
          @load-url="onLoadUrl"
          @download="onDownload"
        />
      </main>
    </n-layout-content>
  </n-layout>
</template>

<style scoped>
.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: clamp(12px, 2vw, 32px);
}
</style>
