<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    class="w-full flex flex-col justify-center items-center"
    :class="`${playlistLookedUp ? 'h-[25vh]' : 'h-[80vh]'}`"
  >
    <PlaylistLookup @search="loadPlaylist" ref="playlistLookup" />
  </div>

  <PlaylistLoader
    v-if="playlistLookedUp"
    :force-refresh="playlistLookup!.forceRefresh"
    ref="playlistLoader"
  />

  <div
    class="mt-4 w-full flex flex-wrap items-stretch justify-center"
    v-if="playlists.length > 0"
  >
    <template v-for="playlist in playlists" :key="playlist.id">
      <div class="w-1/4 px-2 mb-4 flex">
        <UCard variant="subtle" class="flex-1 rounded-2xl">
          <template #header>
            <img
              :src="
                (
                  playlist.snippet.thumbnails.maxres ??
                  playlist.snippet.thumbnails.high ??
                  playlist.snippet.thumbnails.standard ??
                  playlist.snippet.thumbnails.medium ??
                  playlist.snippet.thumbnails.default
                ).url
              "
              :alt="`Thumbnail of '${playlist.snippet.title}'`"
              class="w-full h-full object-cover"
            />
          </template>

          <template #default>
            <h3
              v-if="playlist.snippet.title"
              class="text-lg font-semibold mb-1 truncate"
            >
              {{ playlist.snippet.title }}
            </h3>
            <p class="text-sm text-gray-700 truncate">Description</p>
            <p class="text-sm text-gray-500 mt-1 truncate">
              {{
                playlist.snippet.description ||
                "No description has been set for this playlist."
              }}
            </p>
          </template>

          <template #footer>
            <UButton
              @click="() => loadPlaylist(playlist.id)"
              class="w-full flex justify-center"
              label="Download"
            />
          </template>
        </UCard>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import PlaylistLoader from "~/components/PlaylistLoader.vue";
import PlaylistLookup from "~/components/PlaylistLookup.vue";
import { useUserStore } from "~/stores/userStore";
import { usePlaylistsStore } from "~/stores/playlistsStore";
import type { YoutubeAPIPlaylistsResponse } from "~/types/playlist-list-response";

const playlistLookedUp = ref<boolean>(false);

const playlistLoader = ref<InstanceType<typeof PlaylistLoader>>();
const playlistLookup = ref<InstanceType<typeof PlaylistLookup>>();

async function loadPlaylist(newPlaylistId: string) {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
  playlistLookedUp.value = true;
  await nextTick();
  await playlistLoader.value?.loadPlaylist(
    newPlaylistId,
    playlistLookup.value?.forceRefresh ?? false
  );
}

const userStore = useUserStore();

const playlistsStore = usePlaylistsStore();

const playlists = ref<YoutubeAPIPlaylistsResponse["items"]>([]);

async function loadPlaylists(newPlaylists: YoutubeAPIPlaylistsResponse) {
  playlists.value = newPlaylists.items;
}

onMounted(async () => {
  if (undefined !== playlistsStore.playlists) {
    await loadPlaylists(playlistsStore.playlists);
    return;
  }

  const token = userStore.token.access_token;
  if ("" === token) {
    return;
  }

  const playlists = await $fetch<YoutubeAPIPlaylistsResponse>(
    "/api/playlists/",
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  playlistsStore.setPlaylists(playlists);

  await loadPlaylists(playlists);
});
</script>
