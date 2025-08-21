<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    class="w-full flex flex-col justify-center items-center"
    :class="`${playlistLookedUp ? 'h-[25vh]' : 'h-[100vh]'}`"
  >
    <PlaylistLookup @search="loadPlaylist" ref="playlistLookup" />
  </div>

  <PlaylistLoader
    v-if="playlistLookedUp"
    :force-refresh="playlistLookup!.forceRefresh"
    ref="playlistLoader"
  />
</template>

<script setup lang="ts">
import PlaylistLoader from "~/components/PlaylistLoader.vue";
import PlaylistLookup from "~/components/PlaylistLookup.vue";

const playlistLookedUp = ref<boolean>(false);

const playlistLoader = ref<InstanceType<typeof PlaylistLoader>>();
const playlistLookup = ref<InstanceType<typeof PlaylistLookup>>();

async function loadPlaylist(newPlaylistId: string) {
  playlistLookedUp.value = true;
  await nextTick();
  await playlistLoader.value?.loadPlaylist(
    newPlaylistId,
    playlistLookup.value?.forceRefresh ?? false,
  );
}
</script>
