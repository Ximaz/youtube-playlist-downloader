<template>
  <div>
    <img
      class="size-10 rounded-box w-full aspect-video object-contain bg-black"
      :src="
        (
          playlist.snippet.thumbnails.maxres ??
          playlist.snippet.thumbnails.high ??
          playlist.snippet.thumbnails.standard ??
          playlist.snippet.thumbnails.medium ??
          playlist.snippet.thumbnails.default
        ).url
      "
      :alt="`Thumbnail of the playlist '${playlist.snippet.title}'`"
    />
  </div>
  <div>
    <div>
      {{ playlist.snippet.channelTitle }}
    </div>
    <div class="text-xs uppercase font-semibold opacity-60">
      {{ playlist.snippet.title }}
    </div>
  </div>
  <p class="list-col-wrap text-xs">
    {{
      playlist.snippet.description ||
      "No description provided about this playlist."
    }}
  </p>
  <button class="btn btn-primary" @click="emitter('download', playlist.id)">
    Download
  </button>
</template>
<script setup lang="ts">
import type { YoutubeAPIPlaylistsResponse } from "~/types/playlist-list-response";

const { playlist } = defineProps<{
  playlist: YoutubeAPIPlaylistsResponse["items"][0];
}>();

const emitter = defineEmits<{
  download: [playlistId: string];
}>();
</script>
