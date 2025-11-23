<template>
  <div class="flex flex-col items-center gap-2">
    <div class="flex gap-2">
      <SelectFormat v-model="settings.format" />

      <SelectConvert v-model="settings.convert" />

      <button
        class="btn"
        :disabled="props.loading"
        @click="emit('download', flattenSettings)"
      >
        <span v-if="props.loading" class="loading loading-spinner" />
        {{ props.label }}
      </button>
    </div>

    <label class="label">
      <input type="checkbox" v-model="settings.forceRefresh" class="checkbox" />
      Force refresh
    </label>
  </div>
</template>

<script setup lang="ts">
import { DownloadFormat } from "~/types/download-format";
import SelectFormat from "./settings/SelectFormat.vue";
import SelectConvert from "./settings/SelectConvert.vue";

const props = defineProps<{ label: string; loading: boolean }>();

const settings = reactive<{
  format: DownloadFormat;
  convert: boolean;
  forceRefresh: boolean;
}>({
  format: DownloadFormat.AUDIO_AND_VIDEO,
  convert: false,
  forceRefresh: false,
});

const flattenSettings = computed(() => ({
  audio:
    settings.format === DownloadFormat.AUDIO ||
    settings.format === DownloadFormat.AUDIO_AND_VIDEO,
  video:
    settings.format === DownloadFormat.VIDEO ||
    settings.format === DownloadFormat.AUDIO_AND_VIDEO,
  convert: settings.convert,
  forceRefresh: settings.forceRefresh,
}));

const emit = defineEmits<{
  download: [
    settings: {
      audio: boolean;
      video: boolean;
      convert: boolean;
      forceRefresh: boolean;
    },
  ];
}>();
</script>
