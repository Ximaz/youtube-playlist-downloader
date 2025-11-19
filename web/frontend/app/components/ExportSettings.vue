<template>
  <div class="flex flex-col items-center gap-2">
    <UButtonGroup>
      <USelect :items="FORMATS" v-model="format" />

      <USelect :items="CONVERSIONS" v-model="conversion" />

      <UButton
        class="cursor-pointer"
        color="neutral"
        :label="props.label"
        :loading="props.loading"
        variant="subtle"
        @click="exportPlaylist"
      />
    </UButtonGroup>

    <UCheckbox v-model="forceRefresh" label="Force refresh" />
  </div>
</template>

<script setup lang="ts">
import type { SelectItem } from "@nuxt/ui";
import { ref } from "vue";

const props = defineProps<{ label: string; loading: boolean }>();

const emit = defineEmits<{
  export: [
    settings: {
      audio: boolean;
      video: boolean;
      convert: boolean;
      forceRefresh: boolean;
    },
  ];
}>();

const FORMATS = ref<SelectItem[]>([
  { label: "Audio and video", value: "audio_and_video" },
  { label: "Audio only", value: "audio" },
  { label: "Video only", value: "video" },
]);
const format = ref<"audio" | "video" | "audio_and_video">("audio_and_video");

const CONVERSIONS = ref<SelectItem[]>([
  { label: "Original (WEBA / WEBM)", value: "original" },
  { label: "Converted (M4A / MP4)", value: "converted" },
]);
const conversion = ref<"original" | "converted">("original");

const forceRefresh = ref<boolean>(false);

function exportPlaylist() {
  emit("export", {
    audio: "audio_and_video" === format.value || "audio" === format.value,
    video: "audio_and_video" === format.value || "video" === format.value,
    convert: "converted" === conversion.value,
    forceRefresh: forceRefresh.value,
  });
}
</script>
