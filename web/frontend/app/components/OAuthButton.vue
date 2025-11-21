<template>
  <UButton
    :label="
      url === undefined
        ? 'Loading Google authorization button...'
        : url === null
          ? 'This feature is not supported'
          : 'Retrieve your playlists with Google Sign-in'
    "
    :disabled="undefined === url || null === url"
    :href="typeof url === 'string' ? url : '#'"
    @click="playlistsStore.clear"
    leading-icon="i-lucide-youtube"
  />
</template>

<script lang="ts" setup>
const url = ref<string | null | undefined>();

const playlistsStore = usePlaylistsStore();

onMounted(async () => {
  url.value = await $fetch<string | null>("/api/oauth/authorization");
});
</script>
