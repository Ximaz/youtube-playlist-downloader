<template>
  <div class="flex items-center gap-4 w-full px-4">
    <img
      class="w-auto h-32 object-cover"
      :src="video.thumbnailUrl"
      :alt="`ThumbnailUrl of the video ${video.title}`"
    />
    <div class="flex flex-col gap-2 w-full">
      <p class="w-full">
        {{ video.title }}
      </p>
      <p class="w-full">
        {{ video.author }}
      </p>
      <UProgress class="w-full" :model-value="progress" status />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const { video, steps } = defineProps<{
  video: {
    title: string;
    videoId: string;
    author: string;
    thumbnailUrl: string;
  };
  steps?: string[];
  forceRefresh: boolean;
}>();

const emit = defineEmits<{
  progress: [progress: number];
  error: [error: Error];
}>();

const progress = ref<number>(0);

function updateProgress(newProgress: number, stepName?: string) {
  const progressValue = newProgress;
  const offset =
    undefined !== steps && undefined !== stepName ? steps.indexOf(stepName) : 0;
  const total = steps?.length ?? 1;

  progress.value = 100 * ((progressValue + offset) / total);
  emit("progress", progress.value);
}

defineExpose({
  videoId: video.videoId,
  progress,
  updateProgress,
});
</script>
