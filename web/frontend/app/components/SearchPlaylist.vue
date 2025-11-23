<template>
  <div class="flex flex-col items-center gap-2">
    <div class="join w-full">
      <div class="w-full">
        <label class="input validator join-item w-full">
          <input
            type="url"
            class="grow"
            placeholder="https://www.youtube.com/playlist?list=PL..."
            v-model="playlistUrl"
          />
        </label>
        <div class="validator-hint hidden">
          Enter a valid Youtube playlist URL
        </div>
      </div>

      <button class="btn join-item btn-primary" @click="resolvePlaylist">
        Find the playlist
      </button>
    </div>

    <!-- <div class="flex flex-row w-full justify-around items-center mt-2">
      <label class="label">
        <input v-model="forceRefresh" type="checkbox" class="checkbox" />
        Force refresh
      </label>
    </div> -->
  </div>

  <Modal
    :title="errorTitle"
    :description="errorDescription"
    :open="errorShow"
    @close="errorShow = false"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{
  search: [playlistId: string, forceRefresh: boolean];
}>();

const playlistUrl = ref<string>("");
const forceRefresh = ref<boolean>(false);

const errorTitle = ref<string>("");
const errorDescription = ref<string>("");
const errorShow = ref<boolean>(false);

const PLAYLIST_ID_REGEX =
  /^(?:https:\/\/(?:www\.)?youtube\.com\/playlist\?list=)?(PL[^&]+)/;

function resolvePlaylist() {
  const playlistIdMatch = PLAYLIST_ID_REGEX.exec(playlistUrl.value.trim());

  if (null === playlistIdMatch) {
    errorTitle.value = "Invalid playlist URL";
    errorDescription.value =
      "The playlist ID was not found in the provided URL. Please, make sure you copied a valid playlist URL.";
    errorShow.value = true;
    return void 0;
  }
  errorShow.value = false;

  const playlistId = playlistIdMatch[1] as string;
  emit("search", playlistId, forceRefresh.value);
}
</script>
