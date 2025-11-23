<template>
  <Select
    :default-value="model"
    :items="items"
    @change="
      (value: string) => {
        model = parseInt(value, 10);
      }
    "
  />
</template>

<script setup lang="ts">
import Select from "./Select.vue";
import { DownloadFormat } from "~/types/download-format";

const model = defineModel<DownloadFormat>({ required: true });

const items = ref<{ label: string; value: DownloadFormat }[]>([
  { label: "Audio and video", value: DownloadFormat.AUDIO_AND_VIDEO },
  { label: "Audio only", value: DownloadFormat.AUDIO },
  { label: "Video only", value: DownloadFormat.VIDEO },
]);
</script>
