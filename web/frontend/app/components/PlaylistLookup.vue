<template>
  <div class="flex flex-col items-center gap-2">
    <UButtonGroup>
      <UInput
        icon="i-lucide-search"
        class="w-md"
        size="xl"
        color="neutral"
        variant="outline"
        type="url"
        placeholder="https://www.youtube.com/playlist?list=PL..."
        v-model="playlistUrl"
      />

      <UButton
        class="cursor-pointer"
        color="neutral"
        label="Find the playlist"
        variant="subtle"
        @click="resolvePlaylist"
      />
    </UButtonGroup>

    <div class="flex flex-row w-full justify-around items-center mt-2">
      <OAuthButton />
      <UCheckbox v-model="forceRefresh" label="Force refresh" />
    </div>
  </div>

  <ErrorModal
    :title="errorTitle"
    :description="errorDescription"
    :open="errorShow"
    @close="errorShow = false"
  />
</template>

<script setup lang="ts">
import { ref } from "vue";
import ErrorModal from "@/components/ErrorModal.vue";

const emit = defineEmits<{ search: [playlistId: string] }>();

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
  emit("search", playlistId);
}

defineExpose({
  forceRefresh,
});
</script>
