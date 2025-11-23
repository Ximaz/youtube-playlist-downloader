<template>
  <ul
    v-if="playlists.length > 0"
    class="list bg-base-100 rounded-box shadow-md"
  >
    <li v-for="playlist in playlists" :key="playlist.id" class="list-row">
      <PlaylistPresenter
        :playlist="playlist"
        @download="(playlistId) => emitter('download', playlistId)"
      />
    </li>
  </ul>
</template>
<script setup lang="ts">
import PlaylistPresenter from "~/components/presenters/PlaylistPresenter.vue";
import type { YoutubeAPIPlaylistsResponse } from "~/types/playlist-list-response";

const { playlists } = defineProps<{
  playlists: YoutubeAPIPlaylistsResponse["items"];
}>();

const emitter = defineEmits<{ download: [playlistId: string] }>();
</script>
