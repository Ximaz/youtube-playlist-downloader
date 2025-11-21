import { ref } from "vue";
import { defineStore } from "pinia";
import type { YoutubeAPIPlaylistsResponse } from "~/types/playlist-list-response";

export const usePlaylistsStore = defineStore(
  "playlists",
  () => {
    const playlists = ref<YoutubeAPIPlaylistsResponse>();

    const setPlaylists = (newPlaylists: YoutubeAPIPlaylistsResponse) => {
      playlists.value = newPlaylists;
    };

    const clear = () => {
      playlists.value = undefined;
    };

    return {
      playlists,
      setPlaylists,
      clear,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["playlists"],
    },
  }
);
