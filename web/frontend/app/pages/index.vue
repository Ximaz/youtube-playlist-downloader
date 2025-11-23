<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="hero bg-base-200 min-h-screen">
    <div class="hero-content flex-col lg:flex-row">
      <div class="w-full">
        <h1 class="text-5xl font-bold">Download any playlist</h1>
        <p class="py-4 w-[80%]">
          Get native thumbnails, title and artists metadata, as well as built-in
          format convertion for Apple Music support !
        </p>
        <div class="flex gap-4">
          <GoogleButton />
          <button class="btn btn-outline btn-primary" @click="scrollToApp">
            Use an URL instead
          </button>
        </div>
      </div>
      <div class="mockup-phone w-1/2 border-[#3b3b3b]">
        <div class="mockup-phone-display">
          <img alt="wallpaper" :src="AppleMusicBackground" />
        </div>
      </div>
    </div>
  </div>

  <div
    id="ypd-app"
    class="min-h-[100vh] w-full flex flex-col gap-2 items-center p-4"
  >
    <div class="w-[60%]">
      <SearchPlaylist @search="loadPlaylist" />
    </div>

    <div class="w-full">
      <DownloadPlaylist v-if="playlistLookedUp" ref="downloadPlaylist" />
      <div v-if="playlistLookedUp" class="divider"></div>

      <MyPlaylists :playlists="playlists" @download="loadMyPlaylist" />
    </div>
  </div>
</template>
<script setup lang="ts">
import AppleMusicBackground from "~/assets/img/apple-music-background.png";
import { useUserStore } from "~/stores/userStore";
import { usePlaylistsStore } from "~/stores/playlistsStore";
import type { YoutubeAPIPlaylistsResponse } from "~/types/playlist-list-response";
import type DownloadPlaylist from "~/components/DownloadPlaylist.vue";

const router = useRouter();

const userStore = useUserStore();

const playlistsStore = usePlaylistsStore();

const playlistLookedUp = ref<boolean>(false);

const downloadPlaylist = ref<InstanceType<typeof DownloadPlaylist>>();

async function scrollToApp() {
  await nextTick();

  await router.push({ name: "index", hash: "#ypd-app" });
}

async function loadPlaylist(newPlaylistId: string, forceRefresh?: boolean) {
  await scrollToApp();
  playlistLookedUp.value = true;
  await downloadPlaylist.value?.loadPlaylist(
    newPlaylistId,
    forceRefresh ?? false
  );
}

async function loadMyPlaylist(newPlaylistId: string) {
  await scrollToApp();
  playlistLookedUp.value = true;
  await loadPlaylist(newPlaylistId);
  // await downloadPlaylist.value?.loadMyPlaylist(
  //   newPlaylistId,
  //   playlists.value.find((playlist) => playlist.id === newPlaylistId)
  // );
}

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
