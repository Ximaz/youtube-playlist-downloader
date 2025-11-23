<template>
  <div>
    <img
      class="size-10 rounded-box w-full aspect-video object-contain bg-black"
      :src="video.thumbnailUrl"
      :alt="`ThumbnailUrl of the video '${video.title}'`"
    />
  </div>
  <div>
    <div>
      {{ video.author }}
    </div>
    <div class="text-xs uppercase font-semibold opacity-60">
      {{ video.title }}
    </div>
  </div>
  <p class="list-col-wrap text-xs">
    <progress
      class="progress progress-primary w-full"
      :value="progress"
      max="100"
    />
  </p>
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
